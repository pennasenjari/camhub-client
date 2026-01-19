const { useEffect, useMemo, useRef, useState } = React;

const env = window.__CAMHUB_ENV__ || {};
const apiBase = (env.CAMHUB_API_BASE || "").replace(/\/$/, "");

function buildApiUrl(path) {
  if (!apiBase) return path;
  return `${apiBase}${path}`;
}

function apiClient(token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  return {
    async getConfig() {
      const res = await fetch(buildApiUrl("/api/config"), { headers });
      return res.json();
    },
    async listCameras() {
      const res = await fetch(buildApiUrl("/api/cameras"), { headers });
      return res.json();
    },
    async takeSnapshot(id) {
      const res = await fetch(buildApiUrl(`/api/snapshots/${id}`), {
        method: "POST",
        headers
      });
      return res.json();
    },
    async enableCamera(id) {
      const res = await fetch(buildApiUrl(`/api/cameras/${id}/enable`), {
        method: "POST",
        headers
      });
      return res.json();
    },
    async disableCamera(id) {
      const res = await fetch(buildApiUrl(`/api/cameras/${id}/disable`), {
        method: "POST",
        headers
      });
      return res.json();
    },
    async deleteCamera(id) {
      const res = await fetch(buildApiUrl(`/api/cameras/${id}`), {
        method: "DELETE",
        headers
      });
      return res.json();
    },
    async listMotion(limit = 50) {
      const res = await fetch(buildApiUrl(`/api/motion?limit=${limit}`), { headers });
      return res.json();
    }
  };
}

async function startWhep(video, whepUrl) {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.ontrack = (event) => {
    const [stream] = event.streams;
    if (stream && video.srcObject !== stream) {
      video.srcObject = stream;
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const res = await fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: offer.sdp
  });

  const answerSdp = await res.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  const location = res.headers.get("Location");
  const sessionUrl = location ? new URL(location, whepUrl).toString() : null;
  return { pc, sessionUrl };
}

function CameraTile({ camera, onSnapshot, onDelete, webrtcBase }) {
  const videoRef = useRef(null);
  const sessionRef = useRef(null);
  const [connecting, setConnecting] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !webrtcBase) return;
    let active = true;
    setConnecting(true);
    setError("");

    const streamPath = camera.stream_path || camera.id;
    const whepUrl = `${webrtcBase}/${streamPath}/whep`;
    startWhep(video, whepUrl)
      .then((session) => {
        if (!active) return;
        sessionRef.current = session;
        setConnecting(false);
      })
      .catch((err) => {
        if (!active) return;
        setError("WebRTC failed");
        setConnecting(false);
      });

    return () => {
      active = false;
      if (sessionRef.current?.pc) {
        sessionRef.current.pc.close();
      }
      if (sessionRef.current?.sessionUrl) {
        fetch(sessionRef.current.sessionUrl, { method: "DELETE" }).catch(() => {});
      }
    };
  }, [camera.id, webrtcBase]);

  const statusClass = `status status-${camera.status || "offline"}`;
  const lastSeen = camera.last_seen
    ? new Date(camera.last_seen).toLocaleTimeString()
    : "-";
  const lastMotion = camera.last_motion_at
    ? new Date(camera.last_motion_at).toLocaleTimeString()
    : "-";

  return React.createElement(
    "div",
    { className: "tile" },
    React.createElement(
      "div",
      { className: "tile-header" },
      React.createElement("div", { className: "title" }, camera.name),
      React.createElement("span", { className: statusClass }, camera.status || "offline")
    ),
    React.createElement(
      "video",
      {
        ref: videoRef,
        controls: true,
        muted: true,
        playsInline: true,
        autoPlay: true
      },
      ""
    ),
    connecting
      ? React.createElement("div", { className: "hint" }, "Connecting...")
      : null,
    error ? React.createElement("div", { className: "hint error" }, error) : null,
    React.createElement(
      "div",
      { className: "tile-footer" },
      React.createElement(
        "div",
        { className: "tile-actions" },
        React.createElement(
          "button",
          { onClick: () => onSnapshot(camera.id) },
          "Snapshot"
        ),
        React.createElement(
          "button",
          { className: "danger", onClick: () => onDelete(camera.id) },
          "Remove"
        )
      ),
      React.createElement(
        "span",
        { className: "last-seen" },
        `Last seen: ${lastSeen}`
      ),
      React.createElement(
        "span",
        { className: "last-motion" },
        `Motion: ${lastMotion}`
      )
    )
  );
}

function App() {
  const [cameras, setCameras] = useState([]);
  const [snapshots, setSnapshots] = useState(() => {
    try {
      const stored = localStorage.getItem("camhub_snapshots");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [webrtcBase, setWebrtcBase] = useState("");
  const [motionEvents, setMotionEvents] = useState([]);

  const api = useMemo(() => apiClient(""), []);

  async function refresh() {
    const data = await api.listCameras();
    setCameras(data);
  }

  async function refreshMotion() {
    const data = await api.listMotion(50);
    if (Array.isArray(data)) {
      setMotionEvents(data);
    }
  }

  useEffect(() => {
    api.getConfig().then((cfg) => {
      const fallback = `${window.location.protocol}//${window.location.hostname}:8889`;
      setWebrtcBase(cfg.webrtcBase || fallback);
    });
    refresh();
    refreshMotion();
    const timer = setInterval(refresh, 5000);
    const motionTimer = setInterval(refreshMotion, 10000);
    return () => {
      clearInterval(timer);
      clearInterval(motionTimer);
    };
  }, [api]);

  async function handleSnapshot(id) {
    const data = await api.takeSnapshot(id);
    if (data.ok && data.path) {
      const url = data.path.startsWith("http") ? data.path : buildApiUrl(data.path);
      setSnapshots((prev) => [
        { id, ts: Date.now(), url },
        ...prev
      ]);
    }
  }

  async function handleDelete(id) {
    const ok = window.confirm("Remove this camera?");
    if (!ok) return;
    const data = await api.deleteCamera(id);
    if (data.ok) {
      refresh();
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem("camhub_snapshots", JSON.stringify(snapshots));
    } catch {
      // ignore storage errors
    }
  }, [snapshots]);

  return React.createElement(
    "div",
    { className: "app" },
    React.createElement(
      "header",
      { className: "header" },
      React.createElement("h1", null, "CamHub")
    ),
    React.createElement(
      "section",
      { className: "grid" },
      cameras.map((camera) =>
        React.createElement(CameraTile, {
          key: camera.id,
          camera,
          onSnapshot: handleSnapshot,
          onDelete: handleDelete,
          webrtcBase
        })
      )
    ),
    snapshots.length
      ? React.createElement(
          "section",
          { className: "controls" },
          React.createElement(
            "div",
            { className: "snapshot-list" },
            snapshots.map((snapshot) =>
              React.createElement("img", {
                key: `${snapshot.id}-${snapshot.ts}`,
                className: "snapshot",
                src: `${snapshot.url}?ts=${snapshot.ts}`,
                alt: `Snapshot ${snapshot.id}`
              })
            )
          )
        )
      : null,
    motionEvents.length
      ? React.createElement(
          "section",
          { className: "motion" },
          React.createElement("h2", null, "Recent Motion"),
          React.createElement(
            "div",
            { className: "motion-list" },
            motionEvents.map((event) => {
              const camera = cameras.find((item) => item.id === event.camera_id);
              const label = camera ? camera.name : `Camera ${event.camera_id}`;
              const time = event.ts ? new Date(event.ts).toLocaleTimeString() : "-";
              return React.createElement(
                "div",
                { key: event.id, className: "motion-item" },
                React.createElement(
                  "div",
                  { className: "motion-meta" },
                  React.createElement("span", { className: "motion-camera" }, label),
                  React.createElement("span", { className: "motion-time" }, time)
                ),
                event.snapshot_path
                  ? React.createElement("img", {
                      className: "motion-thumb",
                      src: buildApiUrl(event.snapshot_path),
                      alt: `${label} motion`
                    })
                  : null
              );
            })
          )
        )
      : null
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));

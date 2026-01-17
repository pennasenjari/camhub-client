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
    async addCamera(payload) {
      const res = await fetch(buildApiUrl("/api/cameras"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(payload)
      });
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
      )
    )
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem("camhub_token") || "");
  const [cameras, setCameras] = useState([]);
  const [form, setForm] = useState({ name: "", rtspUrl: "" });
  const [snapshotId, setSnapshotId] = useState(null);
  const [webrtcBase, setWebrtcBase] = useState("");

  const api = useMemo(() => apiClient(token), [token]);

  async function refresh() {
    const data = await api.listCameras();
    setCameras(data);
  }

  useEffect(() => {
    api.getConfig().then((cfg) => {
      const fallback = `${window.location.protocol}//${window.location.hostname}:8889`;
      setWebrtcBase(cfg.webrtcBase || fallback);
    });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [api]);

  async function handleAdd(e) {
    e.preventDefault();
    const data = await api.addCamera({ name: form.name, rtspUrl: form.rtspUrl });
    if (!data.error) {
      setForm({ name: "", rtspUrl: "" });
      refresh();
    }
  }

  async function handleSnapshot(id) {
    const data = await api.takeSnapshot(id);
    if (data.ok) {
      setSnapshotId(id);
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

  function saveToken(value) {
    setToken(value);
    localStorage.setItem("camhub_token", value);
  }

  return React.createElement(
    "div",
    { className: "app" },
    React.createElement(
      "header",
      { className: "header" },
      React.createElement("h1", null, "CamHub"),
      React.createElement(
        "div",
        { className: "token" },
        React.createElement("input", {
          placeholder: "Auth token (optional)",
          value: token,
          onChange: (e) => saveToken(e.target.value)
        })
      )
    ),
    React.createElement(
      "section",
      { className: "controls" },
      React.createElement(
        "form",
        { className: "camera-form", onSubmit: handleAdd },
        React.createElement("input", {
          placeholder: "Camera name",
          value: form.name,
          onChange: (e) => setForm({ ...form, name: e.target.value })
        }),
        React.createElement("input", {
          placeholder: "RTSP URL",
          value: form.rtspUrl,
          onChange: (e) => setForm({ ...form, rtspUrl: e.target.value })
        }),
        React.createElement("button", { type: "submit" }, "Add camera")
      ),
      snapshotId
        ? React.createElement(
            "div",
            { className: "snapshot" },
            React.createElement("img", {
              src: `/snapshots/${snapshotId}.jpg?ts=${Date.now()}`,
              alt: "Latest snapshot"
            })
          )
        : null
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
    )
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(App));

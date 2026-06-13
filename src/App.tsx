import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type ServiceSnapshot = {
  status: string;
  port: number;
  endpoint: string;
  panel_url: string;
  ownership: string;
};

function App() {
  const [snapshot, setSnapshot] = useState<ServiceSnapshot | null>(null);
  const [error, setError] = useState("");

  async function refreshSnapshot() {
    setError("");
    try {
      setSnapshot(await invoke<ServiceSnapshot>("get_service_snapshot"));
    } catch (caught) {
      setError(String(caught));
    }
  }

  return (
    <main className="container">
      <section className="status-panel">
        <div>
          <h1>CliRelay Desktop</h1>
          <p>服务状态</p>
        </div>

        <button type="button" onClick={refreshSnapshot}>
          刷新
        </button>

        {snapshot ? (
          <dl>
            <div>
              <dt>状态</dt>
              <dd>{snapshot.status}</dd>
            </div>
            <div>
              <dt>端口</dt>
              <dd>{snapshot.port}</dd>
            </div>
            <div>
              <dt>入口</dt>
              <dd>{snapshot.endpoint}</dd>
            </div>
            <div>
              <dt>面板</dt>
              <dd>{snapshot.panel_url}</dd>
            </div>
            <div>
              <dt>归属</dt>
              <dd>{snapshot.ownership}</dd>
            </div>
          </dl>
        ) : null}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}

export default App;

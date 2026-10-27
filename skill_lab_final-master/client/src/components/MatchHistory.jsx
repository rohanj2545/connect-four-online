import React, { useEffect, useState } from "react";

export default function MatchHistory({ onBack }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

  useEffect(() => {
    fetch(`${serverUrl}/api/matches`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load match history");
        return res.json();
      })
      .then((data) => {
        setMatches(data.matches || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [serverUrl]);

  return (
    <div className="match-history-card glass-panel">
      <div className="history-header">
        <h2>Recent Completed Matches</h2>
        <button className="btn-secondary btn-sm" onClick={onBack}>
          ← Back to Home
        </button>
      </div>

      {loading && <div className="history-loading">Loading match history...</div>}

      {error && (
        <div className="history-error">
          <p>{error}</p>
          <small>Make sure MongoDB is connected and backend server is running.</small>
        </div>
      )}

      {!loading && !error && matches.length === 0 && (
        <div className="history-empty">
          <p>No completed matches found yet.</p>
          <small>Play a game to the end to save match records!</small>
        </div>
      )}

      {!loading && !error && matches.length > 0 && (
        <div className="table-responsive">
          <table className="matches-table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Room</th>
                <th>Red Player</th>
                <th>Yellow Player</th>
                <th>Outcome</th>
                <th>Moves</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const date = m.createdAt ? new Date(m.createdAt).toLocaleString() : "—";
                const isDraw = m.result === "draw";
                return (
                  <tr key={m._id || m.roomCode + date}>
                    <td className="cell-date">{date}</td>
                    <td><code>{m.roomCode}</code></td>
                    <td className="cell-red">{m.player1}</td>
                    <td className="cell-yellow">{m.player2}</td>
                    <td>
                      <span className={`outcome-badge ${isDraw ? "draw" : "win"}`}>
                        {isDraw ? "Draw" : `Winner: ${m.winner}`}
                      </span>
                    </td>
                    <td>{m.totalMoves}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

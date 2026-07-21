// Dashboard is present but DISABLED in v1 (badge "bientôt"). No implementation
// of the dashboard nor habit-completion tracking — that is v2.
export function DashboardView() {
  return (
    <div className="empty">
      <span className="badge badge-soon" style={{ marginBottom: 12 }}>Bientôt</span>
      <h3>Tableau de bord</h3>
      <p className="muted">
        Le tableau de bord et le suivi de complétion des habitudes arrivent en v2.
      </p>
    </div>
  )
}

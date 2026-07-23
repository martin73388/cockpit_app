import { QuickCapture } from './QuickCapture.jsx'
import { BriefSection } from './BriefSection.jsx'
import { TodaySection } from './TodaySection.jsx'
import { PillarsSection } from './PillarsSection.jsx'
import { AlertsSection } from './AlertsSection.jsx'

// v2 Dashboard — the default tab. Five sections, in this order, mobile-first:
// quick capture/inbox · daily brief · today · life vigilance · alerts.
export function DashboardView({ sources, brief }) {
  return (
    <div className="stack dashboard">
      <QuickCapture />
      <BriefSection brief={brief} />
      <TodaySection />
      <PillarsSection />
      <AlertsSection sources={sources} />
    </div>
  )
}

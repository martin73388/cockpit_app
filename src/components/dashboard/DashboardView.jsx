import { QuickCapture } from './QuickCapture.jsx'
import { BriefSection } from './BriefSection.jsx'
import { YesterdaySection } from './YesterdaySection.jsx'
import { TodaySection } from './TodaySection.jsx'
import { PillarsSection } from './PillarsSection.jsx'
import { AlertsSection } from './AlertsSection.jsx'

// Dashboard — the default tab, mobile-first, in this order:
// quick capture/inbox · daily brief · yesterday's catch-up · today ·
// life vigilance · alerts.
// « Hier » vient juste après le brief : on solde la veille avant de regarder
// le jour. La section disparaît dès qu'il n'y a rien à rattraper.
export function DashboardView({ sources, brief }) {
  return (
    <div className="stack dashboard">
      <QuickCapture />
      <BriefSection brief={brief} />
      <YesterdaySection />
      <TodaySection />
      <PillarsSection />
      <AlertsSection sources={sources} />
    </div>
  )
}

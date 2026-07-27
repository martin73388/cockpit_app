import { QuickCapture } from './QuickCapture.jsx'
import { BriefSection } from './BriefSection.jsx'
import { AgendaSection } from './AgendaSection.jsx'
import { YesterdaySection } from './YesterdaySection.jsx'
import { TodaySection } from './TodaySection.jsx'
import { PillarsSection } from './PillarsSection.jsx'
import { AlertsSection } from './AlertsSection.jsx'

// Dashboard — l'onglet par défaut, pensé mobile, dans cet ordre :
// capture rapide · brief du jour · agenda (le cadre fixe) · rattrapage de la
// veille · aujourd'hui (l'actionnable) · équilibre · alertes.
// Agenda, Hier et Équilibre disparaissent quand ils n'ont rien à dire — le
// Dashboard ne doit jamais faire défiler du vide.
export function DashboardView({ sources, brief, agenda }) {
  return (
    <div className="stack dashboard">
      <QuickCapture />
      <BriefSection brief={brief} />
      <AgendaSection agenda={agenda} />
      <YesterdaySection />
      <TodaySection />
      <PillarsSection />
      <AlertsSection sources={sources} />
    </div>
  )
}

import { isoUtc } from '../util/time'
import { adminStats } from '../repositories/stats'
import type { Db } from '../types'

export function adminStatsView(db: Db) {
  const s = adminStats(db)
  return {
    friends: { active: s.friendsActive, hidden: s.friendsHidden, unreachable: s.friendsUnreachable },
    circle: { sources: s.circleSources, due: s.sourcesDue },
    articles: { total: s.articles, lastArticleAt: isoUtc(s.lastArticleAt) ?? null },
    applications: { pending: s.applicationsPending, total: s.applicationsTotal },
  }
}

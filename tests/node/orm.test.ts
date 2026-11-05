import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { getOrm } from '../../src/server/orm'
import { friends, groups } from '../../src/server/schema'
import { env } from '../helpers'

describe('Drizzle schema / ORM', () => {
  it('读写 JSON archs、upsert 与事务回滚', () => {
    const orm = getOrm(env.DB)
    const group = orm.insert(groups).values({ name: 'ORM 组', sort: 0 }).returning({ id: groups.id }).get()
    const friend = orm
      .insert(friends)
      .values({
        groupId: group.id,
        author: 'A',
        title: 'ORM 站',
        link: 'https://orm.example/',
        archs: ['Nuxt'],
        since: '2024-01-01',
      })
      .returning({ id: friends.id })
      .get()

    const row = orm.select().from(friends).where(eq(friends.id, friend.id)).get()
    expect(row?.archs).toEqual(['Nuxt'])
    expect(row?.inCircle).toBe(1)

    orm.insert(groups)
      .values({ name: 'ORM 组', sort: 9 })
      .onConflictDoUpdate({ target: groups.name, set: { sort: 9 } })
      .run()
    expect(orm.select().from(groups).where(eq(groups.name, 'ORM 组')).get()?.sort).toBe(9)

    orm.update(friends).set({ status: 'hidden', updatedAt: sql`datetime('now')` }).where(eq(friends.id, friend.id)).run()
    expect(orm.select({ status: friends.status }).from(friends).where(eq(friends.id, friend.id)).get()?.status).toBe('hidden')

    expect(() =>
      orm.transaction((tx) => {
        tx.insert(friends)
          .values({ groupId: group.id, author: 'B', title: 'B', link: 'https://b.example/', since: '2024-01-01' })
          .run()
        throw new Error('rollback')
      }),
    ).toThrow('rollback')
    const count = orm.select({ n: sql<number>`COUNT(*)` }).from(friends).get()?.n
    expect(count).toBe(1)
  })
})

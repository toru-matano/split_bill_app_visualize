## Remaining one-line patches

Both `app/group/[token]/member/[memberId]/page.tsx` and
`app/group/[token]/summary/page.tsx` use `useGroup(token)`, which already
goes through the refactored hook and returns decrypted names in the `members`
array.  They only need ONE line changed each: the Supabase expense select.

---

### app/group/[token]/member/[memberId]/page.tsx — line 34

BEFORE:
```ts
.from('expenses').select('*, member:paid_by(id,name)')
```

AFTER:
```ts
.from('expenses').select('*, member:paid_by(id)')
```

Then wherever `e.member?.name` is displayed, replace with:
```ts
members.find(m => m.id === e.paid_by)?.name ?? e.paid_by
```
(The existing `memberName(id)` helper already does this — it just needed the
expense query to stop relying on the now-absent `name` column in the join.)

---

### app/group/[token]/summary/page.tsx — line 32

BEFORE:
```ts
.from('expenses').select('*, member:paid_by(id,name)')
```

AFTER:
```ts
.from('expenses').select('*, member:paid_by(id)')
```

Same substitution: resolve payer names via the `members` array from `useGroup`,
which already contains the server-decrypted names.

---

### Why these are safe

`useGroup` now calls `GET /api/groups/[token]/members` (server route) instead
of querying Supabase directly, so by the time these pages render, `members`
already contains `{ id, name, group_id, created_at }` with plaintext names
from the decryption layer.  The PostgREST join was only ever a convenience to
avoid a second lookup — it is no longer needed or possible since `members.name`
was dropped from the schema.

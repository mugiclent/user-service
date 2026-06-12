/**
 * Copy-on-write override semantics for roles (mirrors trip-service's prices/stops/
 * routes). The platform ships default managed roles (org_id = null); an org never
 * mutates a default — editing one forks an org-scoped deep copy (role + its grants)
 * that shadows the default for that org only. Other orgs keep seeing the default.
 *
 *   default      → org_id = null,  override_of = null,  is_managed = true
 *   org fork     → org_id = X,     override_of = <default id>   (editable copy)
 *   org net-new  → org_id = X,     override_of = null
 *   tombstone    → org_id = X,     override_of = <default id>,  is_hidden = true
 *
 * Unlike permissions (a fixed catalog), default roles are fully editable via fork.
 */

export interface Overridable {
  id: string;
  org_id: string | null;
  override_of: string | null;
  is_hidden: boolean;
}

/**
 * Collapse a candidate set (platform defaults + one org's rows) into the effective
 * view: the org's forks/net-new rows win over the defaults they shadow, tombstoned
 * defaults disappear, and untouched defaults pass through. Rows belonging to other
 * orgs are dropped.
 */
export const resolveEffective = <T extends Overridable>(rows: T[], orgId: string | null): T[] => {
  if (!orgId) return rows.filter((r) => r.org_id === null && !r.is_hidden);

  const shadowed = new Set<string>();
  for (const r of rows) {
    if (r.org_id === orgId && r.override_of) shadowed.add(r.override_of);
  }

  return rows.filter((r) => {
    if (r.org_id === orgId) return !r.is_hidden;        // org's own forks / net-new
    if (r.org_id === null) return !shadowed.has(r.id);   // defaults not forked/hidden by org
    return false;                                        // another org's rows
  });
};

import re
import frappe

_IDENT = re.compile(r"^[A-Za-z0-9_]+$")


def apply_structure_filter(filters, fieldname, alias, tree_doctype):
    """يرجّع (condition_sql, values) لحقل Structure Link مع دعم descendants."""
    node = filters.get(fieldname)
    if not node:
        return "", {}

    if not _IDENT.match(fieldname) or not _IDENT.match(alias):
        frappe.throw("Invalid identifier passed to apply_structure_filter")

    mode = filters.get(f"{fieldname}_match_mode") or "="

    if mode == "descendants of (inclusive)":
        row = frappe.db.get_value(tree_doctype, node, ["lft", "rgt"], as_dict=True)
        if row and row.lft is not None and row.rgt is not None:
            return (
                f" AND `{alias}`.`{fieldname}` IN ("
                f"   SELECT name FROM `tab{tree_doctype}`"
                f"   WHERE lft >= %({fieldname}_lft)s AND rgt <= %({fieldname}_rgt)s"
                f" )",
                {f"{fieldname}_lft": row.lft, f"{fieldname}_rgt": row.rgt},
            )

    return (
        f" AND `{alias}`.`{fieldname}` = %({fieldname}_val)s",
        {f"{fieldname}_val": node},
    )
"""Validation hooks for Structure Link fields.

A `Structure Link` field is only meaningful when its target DocType is a
tree (`is_tree=1`), because the picker depends on `lft` / `rgt` /
`parent_<doctype>` / `is_group`. This module rejects any DocType / Custom
Field / Customize Form Field that points a Structure Link at a non-tree
DocType.

Wired through `hooks.py` `doc_events`, so validation runs on every save -
whether the field was authored from the DocType editor, Form Builder,
Customize Form, or as a Custom Field.
"""

from __future__ import annotations

from typing import Iterable

import frappe
from frappe import _

_HIERARCHY_FIELDTYPE = "Structure Link"


class StructureLinkOptionsError(frappe.ValidationError):
	"""Raised when a Structure Link field is missing or pointing at a non-tree DocType."""


def _is_tree_doctype(name: str | None) -> bool:
	"""Return True iff `name` is an existing DocType marked `is_tree=1`."""
	if not name:
		return False
	is_tree = frappe.db.get_value("DocType", name, "is_tree")
	# DocType.is_tree is stored as 0/1; coerce to bool defensively.
	try:
		return bool(int(is_tree))
	except (TypeError, ValueError):
		return False


def _check_field(field, *, label_context: str) -> None:
	"""Throw if `field` is a Structure Link whose options aren't a tree."""
	if getattr(field, "fieldtype", None) != _HIERARCHY_FIELDTYPE:
		return

	options = (getattr(field, "options", None) or "").strip()
	field_label = (
		getattr(field, "label", None)
		or getattr(field, "fieldname", None)
		or _("(unnamed field)")
	)

	if not options:
		frappe.throw(
			_(
				"{0}: Structure Link field {1} requires Options pointing to a "
				"tree DocType (one with Is Tree enabled)."
			).format(label_context, field_label),
			StructureLinkOptionsError,
		)

	if not frappe.db.exists("DocType", options):
		frappe.throw(
			_(
				"{0}: Structure Link field {1} points to {2}, which is not a "
				"DocType."
			).format(label_context, field_label, options),
			StructureLinkOptionsError,
		)

	if not _is_tree_doctype(options):
		frappe.throw(
			_(
				"{0}: Structure Link field {1} requires {2} to be a tree DocType "
				"(Is Tree must be enabled). Open {2} and tick "
				"&quot;Is Tree&quot; under Settings, or change the field type to "
				"Link if you don't need a hierarchy."
			).format(label_context, field_label, options),
			StructureLinkOptionsError,
		)


def _iter_fields(doc) -> Iterable:
	"""Yield each field child row on a DocType-shaped doc."""
	return getattr(doc, "fields", None) or []


def validate_doctype_structure_links(doc, method=None):
	"""Validate every Structure Link field on a DocType."""
	label = getattr(doc, "name", None) or _("DocType")
	for f in _iter_fields(doc):
		_check_field(f, label_context=label)


def validate_customize_form_structure_links(doc, method=None):
	"""Validate Structure Link fields defined on a Customize Form session."""
	label = getattr(doc, "doc_type", None) or _("Customize Form")
	for f in _iter_fields(doc):
		_check_field(f, label_context=label)


def validate_custom_field_structure_link(doc, method=None):
	"""Validate a single Custom Field row."""
	label = getattr(doc, "dt", None) or _("Custom Field")
	_check_field(doc, label_context=label)

app_name = "structure_link"
app_title = "Structure Link"
app_publisher = "M7md5eir"
app_description = "Adds 'Structure Link' as a first-class fieldtype for Frappe DocTypes."
app_email = "m7md5eir@gmail.com"
app_license = "MIT"

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = "structure_link.bundle.css"
app_include_js = "structure_link.bundle.js"

# Installation
# ------------

after_install = "structure_link.install.after_install"
after_migrate = "structure_link.install.after_migrate"

# Validation hooks
# ----------------
# Reject any Structure Link field whose `options` does not point to a DocType
# with `is_tree=1`. We attach to DocType / Custom Field / Customize Form
# (which is itself a DocType-shaped flow) so the check fires whether the
# field is authored from the DocType editor, Form Builder, Customize Form,
# or as a Custom Field.
doc_events = {
	"DocType": {
		"validate": "structure_link._validation.validate_doctype_structure_links",
	},
	"Custom Field": {
		"validate": "structure_link._validation.validate_custom_field_structure_link",
	},
	"Customize Form": {
		"validate": "structure_link._validation.validate_customize_form_structure_links",
	},
}

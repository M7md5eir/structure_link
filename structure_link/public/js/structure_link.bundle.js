// Structure Link
// ==============
// (الجزء الأصلي بالكامل - زي ما هو)

frappe.provide("structure_link");

// ---------------------------------------------------------------
// Form Builder picker registration
// ---------------------------------------------------------------
(() => {
    if (!frappe?.model?.all_fieldtypes) return;
    const list = frappe.model.all_fieldtypes;
    if (list.includes("Structure Link")) return;
    const link_idx = list.indexOf("Link");
    if (link_idx >= 0) {
        list.splice(link_idx + 1, 0, "Structure Link");
    } else {
        list.push("Structure Link");
    }
})();

// ---------------------------------------------------------------
// Form Builder Vue control registration
// ---------------------------------------------------------------
(() => {
    if (typeof window.SetVueGlobals !== "function") return;
    if (window.SetVueGlobals._structure_link_patched) return;

    const original = window.SetVueGlobals;
    const patched = function (app) {
        original(app);
        if (!app || typeof app.mount !== "function") return;

        const original_mount = app.mount.bind(app);
        app.mount = function (...args) {
            try {
                const link_control = app.component("LinkControl");
                if (link_control && !app.component("StructureLinkControl")) {
                    app.component("StructureLinkControl", link_control);
                }
            } catch (e) {
                // ignore
            }
            return original_mount(...args);
        };
    };
    patched._structure_link_patched = true;
    window.SetVueGlobals = patched;
})();

(() => {
    if (!frappe?.ui?.form?.ControlLink) return;

    const _is_tree_cache = {};

    structure_link.is_tree_doctype = async function (doctype) {
        if (!doctype) return false;
        if (doctype in _is_tree_cache) return _is_tree_cache[doctype];

        try {
            await frappe.model.with_doctype(doctype);
            const meta = frappe.get_meta(doctype);
            _is_tree_cache[doctype] = Boolean(meta && cint(meta.is_tree));
        } catch (e) {
            _is_tree_cache[doctype] = false;
        }
        return _is_tree_cache[doctype];
    };

    const TreePickerMixin = {
        async _hl_tree_on_input(e) {
            const term = e ? e.target.value || "" : "";
            this._hl_search_term = term;
            const doctype = this.get_options();
            if (!doctype) {
                return;
            }

            if (
                !this._hl_tree_records ||
                this._hl_tree_records_doctype !== doctype ||
                this._hl_tree_records_stale
            ) {
                this._hl_tree_records_stale = false;
                const previous_names = this._hl_tree_records
                    ? new Set(this._hl_tree_records.map((r) => r.name))
                    : null;

                this._hl_tree_records = await this._hl_fetch_tree_records(doctype);
                this._hl_tree_records_doctype = doctype;
                this._hl_tree_children_of = this._hl_build_children_map(
                    this._hl_tree_records
                );

                if (!this._hl_expanded) {
                    this._hl_expanded = new Set();
                }

                const current = this.get_value && this.get_value();
                if (current) {
                    this._hl_expand_ancestors(current);
                }

                if (previous_names) {
                    this._hl_tree_records.forEach((rec) => {
                        if (!previous_names.has(rec.name)) {
                            this._hl_expand_ancestors(rec.name);
                        }
                    });
                }

                const pending = this._hl_consume_pending_create(doctype);
                if (pending && pending.names) {
                    const seen = new Set(pending.names);
                    this._hl_tree_records.forEach((rec) => {
                        if (!seen.has(rec.name)) {
                            this._hl_expand_ancestors(rec.name);
                        }
                    });
                }
            }

            const items = this._hl_compute_visible_items(term);
            this._hl_append_footer_items(items, doctype);

            this.awesomplete.list = items;

            this._hl_bind_chevron_handlers();
        },

        _hl_bind_chevron_handlers() {
            if (!this.awesomplete || !this.awesomplete.ul) return;
            const ul = this.awesomplete.ul;
            if (ul._hl_bound) return;
            ul._hl_bound = true;

            const node_to_toggle = (target) => {
                const item = target.closest(".hl-tree-item");
                if (!item) return null;
                const chev = item.querySelector(".hl-chevron");
                if (!chev) return null;
                if (target.closest(".hl-tree-label")) return null;
                return chev.dataset.hlNode || null;
            };
            ul.addEventListener("mousedown", (e) => {
                if (node_to_toggle(e.target)) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                }
            }, true);
            ul.addEventListener("click", (e) => {
                const name = node_to_toggle(e.target);
                if (!name) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                this._hl_toggle_node(name);
            }, true);
        },

        _hl_toggle_node(name) {
            if (!this._hl_expanded) this._hl_expanded = new Set();
            if (this._hl_expanded.has(name)) {
                this._hl_expanded.delete(name);
            } else {
                this._hl_expanded.add(name);
            }

            const term = this._hl_search_term || "";
            const items = this._hl_compute_visible_items(term);
            this._hl_append_footer_items(items, this.get_options());

            const ul = this.awesomplete && this.awesomplete.ul;
            const saved_scroll_top = ul ? ul.scrollTop : 0;

            this.awesomplete.list = items;
            this.awesomplete.open();

            if (ul) {
                ul.scrollTop = saved_scroll_top;
            }
        },

        _hl_expand_ancestors(name) {
            if (!this._hl_tree_records || !this._hl_expanded) return;
            const by_name = new Map();
            this._hl_tree_records.forEach((r) => by_name.set(r.name, r));
            let cur = by_name.get(name);
            while (cur && cur._hl_parent) {
                this._hl_expanded.add(cur._hl_parent);
                cur = by_name.get(cur._hl_parent);
            }
        },

        _hl_build_children_map(records) {
            const map = new Map();
            records.forEach((rec) => {
                const p = rec._hl_parent || "";
                if (!map.has(p)) map.set(p, []);
                map.get(p).push(rec);
            });
            return map;
        },

        _hl_compute_visible_items(search_term) {
            const records = this._hl_tree_records || [];
            const children_of = this._hl_tree_children_of;
            if (!children_of) return [];

            const term = (search_term || "").toLowerCase();
            const has_search = !!term;

            let visible_set = null;
            if (has_search) {
                const by_name = new Map();
                records.forEach((r) => by_name.set(r.name, r));
                visible_set = new Set();
                records.forEach((rec) => {
                    const matches_name = rec.name.toLowerCase().includes(term);
                    const matches_title = rec._hl_title && rec._hl_title.toLowerCase().includes(term);
                    if (!matches_name && !matches_title) return;
                    visible_set.add(rec.name);
                    let p = rec._hl_parent;
                    while (p && !visible_set.has(p)) {
                        visible_set.add(p);
                        const parent_rec = by_name.get(p);
                        p = parent_rec ? parent_rec._hl_parent : null;
                    }
                });
            }

            const result = [];
            const expanded = this._hl_expanded || new Set();
            const walk = (parent_name, depth) => {
                const kids = children_of.get(parent_name) || [];
                for (const rec of kids) {
                    if (visible_set && !visible_set.has(rec.name)) continue;
                    const has_kids =
                        cint(rec.is_group) &&
                        (children_of.get(rec.name) || []).length > 0;
                    const is_open = has_search || expanded.has(rec.name);
                    result.push(this._hl_render_item(rec, depth, has_kids, is_open));
                    if (has_kids && is_open) {
                        walk(rec.name, depth + 1);
                    }
                }
            };
            walk("", 0);
            return result;
        },

        _hl_render_item(rec, depth, has_kids, is_open) {
            const indent = depth * 16;
            const escape_attr = (s) =>
                String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
            const chevron = has_kids
                ? `<span class="hl-chevron ${is_open ? "open" : ""}" data-hl-node="${escape_attr(rec.name)}" aria-label="${__("Expand / collapse")}">
                    <i class="fa ${is_open ? "fa-caret-down" : "fa-caret-right"}"></i>
                </span>`
                : `<span class="hl-chevron-spacer"></span>`;
            const display_label = rec._hl_title || rec.name;
            const is_title_link = !!this._hl_title_field;
            let label_html = `<strong>${frappe.utils.escape_html(display_label)}</strong>`;
            if (is_title_link && rec._hl_title && rec._hl_title !== rec.name) {
                label_html += `<br><span class="small">${frappe.utils.escape_html(rec.name)}</span>`;
            }
            return {
                value: rec.name,
                label: display_label,
                html:
                    `<span class="hl-tree-item" style="padding-left: ${indent}px;">` +
                    `${chevron}<span class="hl-tree-label">${label_html}</span>` +
                    `</span>`,
            };
        },

        _hl_append_footer_items(items, doctype) {
            if (cint(this.df && this.df.only_select)) return;
            if (frappe.model.can_create(doctype)) {
                items.push({
                    html:
                        "<span class='link-option'>" +
                        "<i class='fa fa-plus' style='margin-right: 5px;'></i> " +
                        frappe.utils.escape_html(
                            __("Create a new {0}", [__(doctype)])
                        ) +
                        "</span>",
                    label: __("Create a new {0}", [__(doctype)]),
                    value: "create_new__link_option",
                    action: () => {
                        this._hl_mark_pending_create(doctype);
                        return this.new_doc();
                    },
                });
            }
            if (this.frm) {
                items.push({
                    html:
                        "<span class='link-option'>" +
                        "<i class='fa fa-search' style='margin-right: 5px;'></i> " +
                        frappe.utils.escape_html(__("Advanced Search")) +
                        "</span>",
                    label: __("Advanced Search"),
                    value: "advanced_search__link_option",
                    action: () => {
                        this._hl_mark_pending_create(doctype);
                        return this.open_advanced_search();
                    },
                });
            }
        },

        _hl_pending_storage_key(doctype) {
            return "hl_pending_create:" + doctype;
        },

        _hl_mark_pending_create(doctype) {
            try {
                const names = (this._hl_tree_records || []).map((r) => r.name);
                sessionStorage.setItem(
                    this._hl_pending_storage_key(doctype),
                    JSON.stringify({ names, ts: Date.now() })
                );
            } catch (e) {
                // sessionStorage unavailable - ignore.
            }
        },

        _hl_consume_pending_create(doctype) {
            try {
                const key = this._hl_pending_storage_key(doctype);
                const raw = sessionStorage.getItem(key);
                if (!raw) return null;
                sessionStorage.removeItem(key);
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.names)) {
                    return parsed;
                }
            } catch (e) {
                // sessionStorage unavailable or corrupt - ignore.
            }
            return null;
        },

        async _hl_fetch_tree_records(doctype) {
            const parent_field =
                "parent_" + doctype.toLowerCase().replace(/[\s-]+/g, "_");

            await frappe.model.with_doctype(doctype);
            const meta = frappe.get_meta(doctype);
            const title_field =
                meta && meta.show_title_field_in_link && meta.title_field
                    ? meta.title_field
                    : null;
            this._hl_title_field = title_field;

            const fields = [
                "name",
                `${parent_field} as _hl_parent`,
                "is_group",
                "lft",
                "rgt",
                "creation",
                "modified",
            ];
            if (title_field && title_field !== "name") {
                fields.push(`${title_field} as _hl_title`);
            }

            const args = {
                doctype,
                fields,
                order_by: "lft asc",
                limit_page_length: 0,
            };

            let r;
            try {
                r = await frappe.call({
                    method: "frappe.client.get_list",
                    args,
                    no_spinner: true,
                });
            } catch (err) {
                console.error("structure_link: tree fetch failed", err);
                return [];
            }
            return (r && r.message) || [];
        },
    };

    frappe.ui.form.ControlStructureLink = class ControlStructureLink extends frappe.ui.form.ControlLink {
        make_input() {
            super.make_input();

            this.$input.on("focus.hl_tree", async () => {
                if (this.$input.val()) return;
                this._hl_tree_records_stale = true;
                await this._hl_tree_on_input();
                this.awesomplete && this.awesomplete.open();
            });

            $(document).on("visibilitychange.hl_tree", () => {
                if (!document.hidden) {
                    this._hl_tree_records_stale = true;
                }
            });
            $(window).on("pageshow.hl_tree", (e) => {
                if (e.originalEvent && e.originalEvent.persisted) {
                    this._hl_tree_records_stale = true;
                }
            });
        }

        on_input(e) {
            return this._hl_tree_on_input(e);
        }

        set_options(...args) {
            const out = super.set_options(...args);
            this._hl_tree_records = null;
            this._hl_tree_records_doctype = null;
            return out;
        }

        parse_validate_and_set_in_model(value, e, label) {
            if (
                value &&
                this._hl_tree_records &&
                !this._hl_tree_records.some((r) => r.name === value)
            ) {
                this._hl_tree_records = null;
                this._hl_tree_records_doctype = null;
            }
            if (value && this._hl_title_field && this._hl_tree_records) {
                const rec = this._hl_tree_records.find((r) => r.name === value);
                if (rec && rec._hl_title) {
                    label = label || rec._hl_title;
                    frappe.utils.add_link_title(this.get_options(), value, rec._hl_title);
                }
            }
            return super.parse_validate_and_set_in_model(value, e, label);
        }
    };

    Object.assign(frappe.ui.form.ControlStructureLink.prototype, TreePickerMixin);
})();

// ---------------------------------------------------------------
// List View title resolution for "Structure Link" fields
// ---------------------------------------------------------------
(() => {
    if (frappe.form.formatters.Link) {
        frappe.form.formatters.StructureLink = frappe.form.formatters.Link;
    }

    const LV = frappe.views && frappe.views.ListView;
    if (!LV) return;

    const orig_refresh = LV.prototype.refresh;
    if (!orig_refresh) return;

    LV.prototype.refresh = function (...args) {
        return orig_refresh.apply(this, args).then(() =>
            this._hl_resolve_titles()
        );
    };

    LV.prototype._hl_resolve_titles = async function () {
        if (!this.data || !this.data.length) return;

        const link_title_doctypes = frappe.boot?.link_title_doctypes || [];
        const hl_fields = [];

        for (const col of this.columns || []) {
            const df = col.df;
            if (
                df &&
                df.fieldtype === "Structure Link" &&
                df.options &&
                link_title_doctypes.includes(df.options)
            ) {
                hl_fields.push(df);
            }
        }
        if (!hl_fields.length) return;

        let needs_rerender = false;

        for (const df of hl_fields) {
            await frappe.model.with_doctype(df.options);
            const meta = frappe.get_meta(df.options);
            if (!meta || !meta.show_title_field_in_link || !meta.title_field) {
                continue;
            }

            const values = [
                ...new Set(
                    this.data
                        .map((d) => d[df.fieldname])
                        .filter(Boolean)
                ),
            ].filter((v) => !frappe.utils.get_link_title(df.options, v));

            if (!values.length) continue;

            const result = await frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: df.options,
                    fields: ["name", meta.title_field],
                    filters: { name: ["in", values] },
                    limit_page_length: 0,
                },
            });

            for (const rec of result.message || []) {
                frappe.utils.add_link_title(
                    df.options,
                    rec.name,
                    rec[meta.title_field]
                );
                needs_rerender = true;
            }
        }

        if (needs_rerender) this.render();
    };
})();

// ---------------------------------------------------------------
// List View filter: enable nested-set conditions for Structure Link
// ---------------------------------------------------------------
(() => {
    const Filter = frappe.ui.Filter;
    if (!Filter) return;

    const orig_toggle = Filter.prototype.toggle_nested_set_conditions;
    if (!orig_toggle) return;
    if (orig_toggle._structure_link_patched) return;

    Filter.prototype.toggle_nested_set_conditions = function (df) {
        if (
            df.fieldtype === "Structure Link" &&
            df.options &&
            (frappe.boot.nested_set_doctypes || []).includes(df.options)
        ) {
            const patched_df = Object.assign({}, df, { fieldtype: "Link" });
            return orig_toggle.call(this, patched_df);
        }
        return orig_toggle.call(this, df);
    };
    Filter.prototype.toggle_nested_set_conditions._structure_link_patched = true;

    const proto = Filter.prototype;
    const orig_set_conditions = proto.set_conditions;
    if (orig_set_conditions && !orig_set_conditions._structure_link_patched) {
        proto.set_conditions = function () {
            orig_set_conditions.call(this);
            if (this.invalid_condition_map && !this.invalid_condition_map["Structure Link"]) {
                this.invalid_condition_map["Structure Link"] =
                    this.invalid_condition_map["Link"] || [];
            }
        };
        proto.set_conditions._structure_link_patched = true;
    }
})();

// ---------------------------------------------------------------
// List View standard filter: "Selected Only / Include Children"
// toggle for Structure Link fields pointing at tree DocTypes
// ---------------------------------------------------------------
(() => {
    const LV = frappe.views && frappe.views.ListView;
    if (!LV) return;

    const orig_setup = LV.prototype.setup_filter_area;
    if (!orig_setup || orig_setup._sl_tree_toggle_patched) return;

    const getIcon = (mode) =>
        mode === "=" ? frappe.utils.icon("equal", "sm") : frappe.utils.icon("list-tree", "sm");
    const getTitle = (mode) =>
        mode === "=" ? __("Equal") : __("Descendants Of (inclusive)");

    LV.prototype.setup_filter_area = function (...args) {
        const result = orig_setup.apply(this, args);

        const fa = this.filter_area;
        if (!fa) return result;

        const FA_proto = Object.getPrototypeOf(fa);
        if (FA_proto && !FA_proto._sl_tree_toggle_patched) {
            const orig_make = FA_proto.make_standard_filters;
            if (orig_make) {
                FA_proto.make_standard_filters = async function (...a) {
                    await orig_make.apply(this, a);
                    _sl_add_tree_toggles(this);
                };
            }

            _sl_add_tree_toggles(fa);

            const orig_set_sf = FA_proto.set_standard_filter;
            if (orig_set_sf) {
                FA_proto.set_standard_filter = function (filters) {
                    if (filters.length === 0) {
                        return { non_standard_filters: [], promise: Promise.resolve() };
                    }
                    const fields_dict = this.list_view.page.fields_dict;

                    return filters.reduce((out, filter) => {
                        const [dt, fieldname, condition, value] = filter;
                        out.promise = out.promise || Promise.resolve();
                        out.non_standard_filters = out.non_standard_filters || [];

                        const fd = fields_dict[fieldname];
                        const is_link_tree =
                            condition === "descendants of (inclusive)" &&
                            fd && fd.df && fd.df.fieldtype === "Link";
                        const is_sl_tree =
                            condition === "descendants of (inclusive)" &&
                            fd && fd.df && fd.df._sl_tree_field;
                        const is_standard =
                            fd &&
                            (condition === "=" ||
                                (condition === "like" && fd.df && fd.df.fieldtype !== "Link") ||
                                is_link_tree || is_sl_tree);

                        if (is_standard) {
                            out.promise = out.promise.then(() => {
                                if (fd.df) fd.df.match_type = condition;
                                return fd.set_value(value);
                            });
                        } else {
                            out.non_standard_filters.push(filter);
                        }
                        return out;
                    }, {});
                };
            }

            const orig_get_sf = FA_proto.get_standard_filters;
            if (orig_get_sf) {
                FA_proto.get_standard_filters = function () {
                    const filters = [];
                    const fields_dict = this.list_view.page.fields_dict;

                    for (let key in fields_dict) {
                        const field = fields_dict[key];
                        let value = field.get_value();
                        if (!value) continue;

                        const match_type = field.df.match_type || "=";
                        let condition;

                        if (match_type === "like") {
                            condition = "like";
                            if (typeof value === "string" && !value.includes("%")) {
                                value = "%" + value + "%";
                            }
                        } else if (match_type === "=") {
                            condition = "=";
                            if (typeof value === "string") {
                                value = value.replace(/^%+|%+$/g, "");
                            }
                        } else {
                            condition = field.df.condition || match_type;
                        }

                        filters.push([
                            field.df.doctype || this.list_view.doctype,
                            field.df.fieldname,
                            condition,
                            value,
                        ]);
                    }
                    return filters;
                };
            }

            FA_proto._sl_tree_toggle_patched = true;
        }

        return result;
    };
    LV.prototype.setup_filter_area._sl_tree_toggle_patched = true;

    function _sl_add_tree_toggles(filterArea) {
        const fields_dict = filterArea.list_view.page.fields_dict;
        const meta_fields = filterArea.list_view.meta.fields;
        const nested = frappe.boot.nested_set_doctypes || [];

        for (let key in fields_dict) {
            const field = fields_dict[key];
            if (!field || !field.df || !field.$wrapper) continue;

            const orig_df = meta_fields.find((f) => f.fieldname === key);
            if (!orig_df) continue;
            if (orig_df.fieldtype !== "Structure Link") continue;
            if (!orig_df.options || !nested.includes(orig_df.options)) continue;

            field.df.condition = "descendants of (inclusive)";
            field.df.match_type = "descendants of (inclusive)";
            field.df._sl_tree_field = true;

            _sl_add_toggle_button(filterArea, field);
        }
    }

    function _sl_add_toggle_button(filterArea, field) {
        const $input = field.$wrapper.find("input").first();
        if (!$input.length || $input.closest(".input-group").length) return;

        $input.wrap('<div class="input-group"></div>');
        const $inputGroup = $input.parent();
        const currentMode = field.df.match_type || "descendants of (inclusive)";

        const $dropdown = $(`
            <div class="input-group-btn mr-0">
                <button type="button"
                    class="btn btn-default match-type-dropdown-btn"
                    data-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="false"
                    title="${getTitle(currentMode)}">
                    ${getIcon(currentMode)}
                </button>
                <ul class="dropdown-menu match-type-dropdown-menu dropdown-menu-right">
                    <li class="dropdown-item" data-match-type="=">
                        ${__("Equal")}
                    </li>
                    <li class="dropdown-item" data-match-type="descendants of (inclusive)">
                        ${__("Descendants Of (inclusive)")}
                    </li>
                </ul>
            </div>
        `);

        $inputGroup.append($dropdown);

        $dropdown.find(".dropdown-item").on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            $dropdown.find("button").dropdown("toggle");

            const new_type = $(e.currentTarget).data("match-type");
            const current_type = field.df.match_type || "descendants of (inclusive)";
            if (new_type === current_type) return;

            field.df.match_type = new_type;
            field.df.condition = new_type;
            $dropdown
                .find("button")
                .html(getIcon(new_type))
                .attr("title", getTitle(new_type));

            if (field.get_value && field.get_value()) {
                filterArea.debounced_refresh_list_view();
            }
        });
    }
})();

// ===============================================================
// Query Report support for "Structure Link" fields  (NEW)
// ===============================================================
// Adds the same Equal / Descendants-Of toggle to Structure Link
// filters in ANY query report, and ships the chosen mode to the
// server as `<fieldname>_match_mode` so the report's execute()
// can translate it via the shared `apply_structure_filter` helper.
//
// Unlike the List View, the query-report server side (execute())
// does NOT auto-translate the condition - each report must call
// the Python helper. The frontend here only renders the toggle
// and forwards the chosen mode.
(() => {
    const QR = frappe.views && frappe.views.QueryReport;
    if (!QR) return;

    const getIcon = (mode) =>
        mode === "=" ? frappe.utils.icon("equal", "sm") : frappe.utils.icon("list-tree", "sm");
    const getTitle = (mode) =>
        mode === "=" ? __("Equal") : __("Descendants Of (inclusive)");

    // --- 1) Forward the chosen mode to the server -----------------
    // Patch get_filter_values so every Structure Link filter also
    // emits `<fieldname>_match_mode`.
    if (!QR.prototype._sl_getvalues_patched && QR.prototype.get_filter_values) {
        const orig_get = QR.prototype.get_filter_values;
        QR.prototype.get_filter_values = function (raise) {
            const values = orig_get.call(this, raise) || {};
            for (const f of this.filters || []) {
                const df = f && f.df;
                if (df && df.fieldtype === "Structure Link" && values[df.fieldname]) {
                    values[df.fieldname + "_match_mode"] = f._sl_match_mode || "=";
                }
            }
            return values;
        };
        QR.prototype._sl_getvalues_patched = true;
    }

    // --- 2) Render the toggle after filters are drawn -------------
    if (!QR.prototype._sl_report_patched && QR.prototype.refresh_filters) {
        const orig_rf = QR.prototype.refresh_filters;
        QR.prototype.refresh_filters = function (...args) {
            const out = orig_rf.apply(this, args);
            Promise.resolve(out).finally(() => _sl_add_report_toggles(this));
            return out;
        };
        QR.prototype._sl_report_patched = true;
    }

    // Fallback hook: many Frappe versions build filters in
    // `make_query_report` / `setup_filters`. Patch whichever exists.
    ["setup_filters", "make_query_report", "load_report"].forEach((m) => {
        if (QR.prototype[m] && !QR.prototype[m]._sl_patched) {
            const orig = QR.prototype[m];
            QR.prototype[m] = function (...args) {
                const out = orig.apply(this, args);
                Promise.resolve(out).finally(() => _sl_add_report_toggles(this));
                return out;
            };
            QR.prototype[m]._sl_patched = true;
        }
    });

    function _sl_add_report_toggles(report) {
        if (!report || !report.filters || !report.filters.length) return;
        const nested = frappe.boot.nested_set_doctypes || [];

        for (const field of report.filters) {
            const df = field && field.df;
            if (!df || df.fieldtype !== "Structure Link") continue;
            if (!df.options || !nested.includes(df.options)) continue;
            if (!field.$wrapper) continue;

            if (!field._sl_match_mode) field._sl_match_mode = "=";
            _sl_add_report_toggle_button(report, field);
        }
    }

    function _sl_add_report_toggle_button(report, field) {
        const $input = field.$wrapper.find("input").first();
        if (!$input.length || $input.closest(".input-group").length) return;

        $input.wrap('<div class="input-group"></div>');
        const $group = $input.parent();
        const mode = field._sl_match_mode || "=";

        const $dropdown = $(`
            <div class="input-group-btn mr-0">
                <button type="button"
                    class="btn btn-default match-type-dropdown-btn"
                    data-toggle="dropdown"
                    aria-haspopup="true"
                    aria-expanded="false"
                    title="${getTitle(mode)}">
                    ${getIcon(mode)}
                </button>
                <ul class="dropdown-menu match-type-dropdown-menu dropdown-menu-right">
                    <li class="dropdown-item" data-match-type="=">
                        ${__("Equal")}
                    </li>
                    <li class="dropdown-item" data-match-type="descendants of (inclusive)">
                        ${__("Descendants Of (inclusive)")}
                    </li>
                </ul>
            </div>
        `);

        $group.append($dropdown);

        $dropdown.find(".dropdown-item").on("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            $dropdown.find("button").dropdown("toggle");

            const new_mode = $(e.currentTarget).data("match-type");
            if (new_mode === field._sl_match_mode) return;

            field._sl_match_mode = new_mode;
            $dropdown
                .find("button")
                .html(getIcon(new_mode))
                .attr("title", getTitle(new_mode));

            if (field.get_value && field.get_value()) {
                report.refresh();
            }
        });
    }
})();
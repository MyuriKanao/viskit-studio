// AUTO-GENERATED from packages/schemas/openapi.yaml — do not edit by hand
export interface paths {
    "/api/images/{image_id}/bytes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Image Bytes
         * @description Serve canonical editor image bytes for kit slots and generated assets.
         */
        get: operations["image_bytes_api_images__image_id__bytes_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/images/{image_id}/edit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Start Edit */
        post: operations["start_edit_api_images__image_id__edit_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/images/{image_id}/edit/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Edit Events */
        get: operations["edit_events_api_images__image_id__edit_events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/images/{image_id}/ocr": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ocr Image */
        post: operations["ocr_image_api_images__image_id__ocr_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/images/{image_id}/save": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Save Edited Image
         * @description Persist an edit result via an explicit replace-or-copy choice.
         */
        post: operations["save_edited_image_api_images__image_id__save_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Kits
         * @description Return kits joined with their product catalog row, paginated & filtered.
         *
         *     ``thumbs`` is the concatenation of up-to-5 hero png_paths (slot 1..5) and
         *     up-to-9 detail png_paths (M1..M9) — 14 slots total, NULL-padded for any
         *     missing rows.  Callers render placeholder cells for NULL entries.
         *
         *     ``recent`` is advisory; sort defaults to ``created_at DESC`` to preserve
         *     the EPIC-7 Dashboard call shape (``?recent=true&limit=6``).  Catalog
         *     (EPIC-8) passes ``offset``, ``status``, ``locale``, ``min_score``,
         *     ``category``, ``sort``, ``order`` for filtered/paginated views.
         */
        get: operations["list_kits_api_kits_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/_warmup/extract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Warmup Extract
         * @description Prime the vision provider connection so the first /extract call is warm.
         *
         *     Deliberately uses probe(timeout=5) — a 5s deviation from the 30s default
         *     because this is a best-effort fire-and-forget warmup; we swallow all
         *     failures and always return 204 so the frontend never sees an error.
         */
        get: operations["warmup_extract_api_kits__warmup_extract_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{db_kit_id}/images/{image_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Delete Generated Image
         * @description Remove a generated image from a catalog kit slot and delete its PNG.
         */
        delete: operations["delete_generated_image_api_kits__db_kit_id__images__image_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{db_kit_id}/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Kit Meta
         * @description Read result sidecars for *db_kit_id*; 404 if the kit root is unknown.
         */
        get: operations["get_kit_meta_api_kits__db_kit_id__meta_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{kit_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Kit Events
         * @description Stream per-image status events for *kit_id* as text/event-stream.
         *
         *     Returns 404 when the kit_id has never been published to the bus
         *     (callers can use this as a "kit not started" signal).  Each line
         *     conforms to the SSE wire format::
         *
         *         data: {"image_id": "H1", "status": "color_locked", "progress": 0,
         *                "brand_color_locked": true}
         */
        get: operations["get_kit_events_api_kits__kit_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{kit_id}/extract": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Extract
         * @description Extract per-field inferences from a product image.
         *
         *     Uses the vision provider (registry role "vision"); falls back to "llm" if
         *     the vision role is unavailable (R2 mitigation).
         *
         *     Reserved-prefix guard: POST to kit_id='_warmup' returns 404 — defensive
         *     against POST collision with the GET /_warmup/extract warmup endpoint.
         */
        post: operations["extract_api_kits__kit_id__extract_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{kit_id}/generate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Generate
         * @description Generate the 14-image kit for *kit_id*.
         */
        post: operations["post_generate_api_kits__kit_id__generate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{kit_id}/images/{image_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Generated Image
         * @description Serve a generated kit image by public kit id and slot id.
         */
        get: operations["get_generated_image_api_kits__kit_id__images__image_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/kits/{kit_id}/spec": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create Spec
         * @description Generate the marketing spec for *kit_id* under the requested locale.
         */
        post: operations["create_spec_api_kits__kit_id__spec_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/metrics/weekly": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Weekly Metrics
         * @description Aggregate live metrics — current-ISO-week kits + 12-week sparklines.
         */
        get: operations["get_weekly_metrics_api_metrics_weekly_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/onboarding/needed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Onboarding Needed
         * @description Return whether onboarding is needed for this workspace.
         */
        get: operations["get_onboarding_needed_api_onboarding_needed_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/config-state": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Config State
         * @description Return the on-disk YAML body and its SHA-256 checksum.
         *
         *     Kept for legacy/admin tools that need an explicit config-body save path.
         *     Bootstrapping the live config file is a lifespan concern
         *     (``apps.api.main._bootstrap_config_if_missing``), so this route is
         *     side-effect-free; if the file truly doesn't exist, 404.
         */
        get: operations["get_config_state_api_providers_config_state_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/endpoints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Save Endpoints
         * @description Save the new config YAML body.  ADR-010 v2 lock+checksum semantics.
         */
        post: operations["save_endpoints_api_providers_endpoints_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/endpoints/{role}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Endpoint
         * @description Return the structured stanza for *role* so the UI can prefill the edit modal.
         */
        get: operations["get_endpoint_api_providers_endpoints__role__get"];
        /**
         * Update Endpoint
         * @description Replace a single role's stanza.
         *
         *     ``api_key`` semantics: ``None``, empty string, and whitespace-only all
         *     mean "preserve the existing env-var binding on disk".  Any other value
         *     is persisted to the secrets store and the YAML's ``api_key_env`` is
         *     rewritten to the derived env name.  To explicitly unbind, DELETE the
         *     role and re-POST.
         */
        put: operations["update_endpoint_api_providers_endpoints__role__put"];
        /**
         * Create Endpoint
         * @description Create a single role stanza without exposing YAML editing to the UI.
         */
        post: operations["create_endpoint_api_providers_endpoints__role__post"];
        /**
         * Delete Endpoint
         * @description Remove a role's stanza from config.yaml and re-boot the registry.
         *
         *     Read-modify-write under the same lock+checksum protocol as POST.  Missing
         *     role → 404.  Required roles (``REQUIRED_ROLES``) → 409; deleting them
         *     would crash the next startup with ERR-PROV-001.  Use PUT to swap settings.
         */
        delete: operations["delete_endpoint_api_providers_endpoints__role__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/endpoints/{role}/secret": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Endpoint Secret
         * @description Return the locally saved secret for *role*.
         *
         *     Only keys saved through ``data/secrets.json`` are revealable.  If the
         *     endpoint is backed by a shell/environment variable, the UI can still probe
         *     it via ``api_key_env`` but the plaintext value is not exposed here.
         */
        get: operations["get_endpoint_secret_api_providers_endpoints__role__secret_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Provider Health
         * @description Per-role health snapshot derived from ``app.state.registry``.
         *
         *     Latency probes are not yet implemented (status/latency_ms stubbed to
         *     None).  When a known role has no binding, the row carries the role
         *     name in ``unbound`` so the frontend can render the warning chip.
         */
        get: operations["get_provider_health_api_providers_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/models": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List Provider Models
         * @description Probe registry-bound adapter model catalogs.
         *
         *     Each adapter hits its own ``/models`` endpoint (OpenAI: ``{base_url}/models``,
         *     Anthropic: ``{base_url}/v1/models``). Passing ``?role=llm`` probes just one
         *     role so the UI can test a row without waiting for every configured backend.
         */
        get: operations["list_provider_models_api_providers_models_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/probe": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Probe Candidate
         * @description Probe a candidate (un-registered) endpoint and return its model catalog.
         *
         *     Accepts either an existing ``api_key_env`` name (looked up via
         *     ``os.environ``) or an inline ``api_key`` (used directly for the probe but
         *     never persisted).  The inline path lets the AddEndpointModal probe a
         *     freshly-pasted key before the operator commits to saving it.
         *
         *     Adapter contract: ``probe()`` never raises — failures surface as
         *     ``ok=False`` with an ``error`` string.
         */
        post: operations["probe_candidate_api_providers_probe_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/secrets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Store Secret
         * @description Persist an API key to the gitignored secrets store + inject into env.
         *
         *     Derives a deterministic env-var name from ``role`` + ``name`` so the
         *     operator never has to invent one.  The plaintext key lives only in
         *     ``data/secrets.json`` (gitignored); ``config.yaml`` continues to store
         *     only the env-var name per ADR-011.
         */
        post: operations["store_secret_api_providers_secrets_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/providers/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Provider Summary
         * @description Summary of the on-disk ``config.yaml``.
         */
        get: operations["get_provider_summary_api_providers_summary_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/queue/active": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Get Active Queue
         * @description Return the snapshot of active kits.  Empty list when idle.
         */
        get: operations["get_active_queue_api_queue_active_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Post Settings
         * @description Read-modify-write the 4 workspace-level options into config.yaml.
         *
         *     Retries up to ``_MAX_CHECKSUM_RETRIES`` times if the config drifted
         *     underneath us (concurrent provider save).  Inode-changed is treated
         *     identically to checksum-mismatch.
         */
        post: operations["post_settings_api_settings_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Templates */
        get: operations["get_templates_api_templates_get"];
        put?: never;
        /** Create Template */
        post: operations["create_template_api_templates_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Copy Template */
        post: operations["copy_template_api_templates_copy_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/managed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Managed Templates */
        get: operations["get_managed_templates_api_templates_managed_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Template */
        post: operations["preview_template_api_templates_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/schemes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Schemes */
        get: operations["list_schemes_api_templates_schemes_get"];
        put?: never;
        /** Create Scheme */
        post: operations["create_scheme_api_templates_schemes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/templates/{template_ref}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Template */
        delete: operations["delete_template_api_templates__template_ref__delete"];
        options?: never;
        head?: never;
        /** Update Template */
        patch: operations["update_template_api_templates__template_ref__patch"];
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Health
         * @description Probe the configured database with a 2s timeout.
         */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** ComplianceOut */
        ComplianceOut: {
            /** Advisory */
            advisory: boolean;
            /** Locale */
            locale: string;
            /** Score */
            score: number;
            /** Violations */
            violations: components["schemas"]["ViolationOut"][];
        };
        /** ConfigStateResponse */
        ConfigStateResponse: {
            /** Sha256 */
            sha256: string;
            /** Yaml */
            yaml: string;
        };
        /** CopyTemplateRequest */
        CopyTemplateRequest: {
            /** Name */
            name?: string | null;
            /** Source Ref */
            source_ref: string;
        };
        /** CreateEndpointRequest */
        CreateEndpointRequest: {
            /** Adapter */
            adapter?: string | null;
            /** Api Key */
            api_key: string;
            /** Base Url */
            base_url: string;
            /** Model */
            model: string;
            /** Name */
            name: string;
            /**
             * Protocol
             * @enum {string}
             */
            protocol: "openai_compatible" | "anthropic_compatible" | "image_generation";
        };
        /** DeleteKitImageResponse */
        DeleteKitImageResponse: {
            /** Deleted */
            deleted: boolean;
            /** File Deleted */
            file_deleted: boolean;
            /** Image Id */
            image_id: string;
            /** Kit Id */
            kit_id: number;
        };
        /** DetailSectionIn */
        DetailSectionIn: {
            /**
             * Id
             * @enum {string}
             */
            id: "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9";
            three_piece: components["schemas"]["ThreePieceIn"];
        };
        /** DetailSectionOut */
        DetailSectionOut: {
            /**
             * Id
             * @enum {string}
             */
            id: "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9";
            three_piece: components["schemas"]["ThreePieceOut"];
        };
        /** EditAccepted */
        EditAccepted: {
            /** Job Id */
            job_id: string;
        };
        /** EditRequest */
        EditRequest: {
            /**
             * Kit Id
             * @description Optional kit id for local edit context; safe-character allowlist keeps sidecar references portable.
             */
            kit_id?: string | null;
            /**
             * Mask Box
             * @description x,y,w,h
             */
            mask_box: {
                [key: string]: number;
            };
            /** New Text */
            new_text: string;
        };
        /** EndpointSecretResponse */
        EndpointSecretResponse: {
            /** Api Key */
            api_key: string;
        };
        /** EndpointStanza */
        EndpointStanza: {
            /** Adapter */
            adapter?: string | null;
            /** Api Key Env */
            api_key_env: string;
            /** Base Url */
            base_url: string;
            /** Model */
            model: string;
            /** Protocol */
            protocol: string;
        };
        /** ExtractRequest */
        ExtractRequest: {
            /** Description */
            description?: string | null;
            /** Image Url */
            image_url: string;
        };
        /** ExtractResponse */
        ExtractResponse: {
            brand: components["schemas"]["FieldInference"];
            brand_color_hex: components["schemas"]["FieldInference"];
            category: components["schemas"]["FieldInference"];
            name: components["schemas"]["FieldInference"] | null;
            price: components["schemas"]["FieldInference"] | null;
            product_type: components["schemas"]["FieldInference"];
            /** Selling Points */
            selling_points: components["schemas"]["FieldInference"][];
        };
        /** FieldInference */
        FieldInference: {
            /** Confidence */
            confidence: number;
            /** Reasoning */
            reasoning: string;
            /** Value */
            value: unknown;
        };
        /** GenerateRequest */
        GenerateRequest: {
            /** Brand Color Hex */
            brand_color_hex: string;
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Retrieved Bestseller Ids */
            retrieved_bestseller_ids?: number[];
            spec: components["schemas"]["SpecIn"];
            /** Style Prompt */
            style_prompt?: string | null;
            /** Template Scheme Ref */
            template_scheme_ref?: string | null;
            /** Template Slot Overrides */
            template_slot_overrides?: {
                [key: string]: string;
            };
        };
        /** GenerateResponse */
        GenerateResponse: {
            /** Abort Reason */
            abort_reason?: string | null;
            /** Color Lock Summary */
            color_lock_summary: {
                [key: string]: number;
            };
            /** Compliance Path */
            compliance_path: string;
            /** Cost Path */
            cost_path: string;
            /** Db Kit Id */
            db_kit_id: number;
            /** Kit Id */
            kit_id: string;
            /** Needs Review */
            needs_review: boolean;
            /** Png Paths */
            png_paths: string[];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** HeroSectionIn */
        HeroSectionIn: {
            /**
             * Id
             * @enum {string}
             */
            id: "H1" | "H2" | "H3" | "H4" | "H5";
            three_piece: components["schemas"]["ThreePieceIn"];
        };
        /** HeroSectionOut */
        HeroSectionOut: {
            /**
             * Id
             * @enum {string}
             */
            id: "H1" | "H2" | "H3" | "H4" | "H5";
            three_piece: components["schemas"]["ThreePieceOut"];
        };
        /** KitListItem */
        KitListItem: {
            /** Category */
            category?: string | null;
            /** Id */
            id: number;
            /** Locale */
            locale: string | null;
            /** Name */
            name: string;
            /** Name En */
            name_en: string | null;
            /** Score */
            score: number | null;
            /** Sku */
            sku: string;
            /** Status */
            status: string;
            /** Thumbs */
            thumbs: (string | null)[];
            /** Updated At */
            updated_at?: string | null;
        };
        /** KitListResponse */
        KitListResponse: {
            /** Items */
            items: components["schemas"]["KitListItem"][];
            /** Total */
            total: number;
        };
        /**
         * KitMetaResponse
         * @description Side-car payload for kit detail and the EPIC-9 Catalog drawer.
         */
        KitMetaResponse: {
            /** Compliance */
            compliance?: {
                [key: string]: unknown;
            } | null;
            /** Cost */
            cost?: {
                [key: string]: unknown;
            } | null;
            /** Db Kit Id */
            db_kit_id: number;
            /** Kit Id */
            kit_id?: string | null;
            /** Retrieved Bestseller Ids */
            retrieved_bestseller_ids: number[];
            /** Spec */
            spec?: {
                [key: string]: unknown;
            } | null;
            /** Spec Markdown */
            spec_markdown?: string | null;
        };
        /** OcrResponse */
        OcrResponse: {
            /** Boxes */
            boxes: components["schemas"]["TextBoxOut"][];
            /** Engine */
            engine: string;
            /** Version */
            version: string;
        };
        /** OnboardingNeededResponse */
        OnboardingNeededResponse: {
            /** Needs Onboarding */
            needs_onboarding: boolean;
        };
        /** PreviewRequest */
        PreviewRequest: {
            /**
             * Brand Color Hex
             * @default #C4513A
             */
            brand_color_hex: string;
            /**
             * Copy
             * @default 新品上市
             */
            copy: string;
            /**
             * Design Note
             * @default keep product centered with premium spacing
             */
            design_note: string;
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /**
             * Sample Brand
             * @default 示例品牌
             */
            sample_brand: string;
            /**
             * Sample Category
             * @default 服饰
             */
            sample_category: string;
            /**
             * Sample Name
             * @default 示例商品
             */
            sample_name: string;
            /**
             * Style Prompt
             * @default warm minimalist studio, soft daylight
             */
            style_prompt: string;
            /** Template Ref */
            template_ref: string;
            /**
             * Visual
             * @default single product hero image, clean ecommerce composition
             */
            visual: string;
        };
        /** PreviewResponse */
        PreviewResponse: {
            /** Cost Usd */
            cost_usd: number;
            /** Png Path */
            png_path: string | null;
            /** Prompt */
            prompt: string;
        };
        /** ProbeCandidateRequest */
        ProbeCandidateRequest: {
            /** Adapter */
            adapter?: string | null;
            /** Api Key */
            api_key?: string | null;
            /** Api Key Env */
            api_key_env?: string | null;
            /** Base Url */
            base_url: string;
            /**
             * Protocol
             * @enum {string}
             */
            protocol: "openai_compatible" | "anthropic_compatible" | "image_generation";
        };
        /** ProbeCandidateResponse */
        ProbeCandidateResponse: {
            /** Error */
            error?: string | null;
            /** Latency Ms */
            latency_ms: number;
            /** Models */
            models: string[];
            /** Ok */
            ok: boolean;
        };
        /** ProviderHealthRow */
        ProviderHealthRow: {
            /** Base Url */
            base_url: string | null;
            /** Endpoint Id */
            endpoint_id: string;
            /** Last Check */
            last_check: string | null;
            /** Latency Ms */
            latency_ms: number | null;
            /** Role */
            role: string;
            /** Status */
            status: ("ok" | "warn" | "error") | null;
            /** Unbound */
            unbound?: string[] | null;
        };
        /** ProviderProbeResponse */
        ProviderProbeResponse: {
            /** Rows */
            rows: components["schemas"]["ProviderProbeRow"][];
        };
        /** ProviderProbeRow */
        ProviderProbeRow: {
            /** Error */
            error?: string | null;
            /** Latency Ms */
            latency_ms: number;
            /** Models */
            models: string[];
            /** Ok */
            ok: boolean;
            /** Role */
            role: string;
        };
        /** ProvidersSummaryResponse */
        ProvidersSummaryResponse: {
            /** Brand Color */
            brand_color: string | null;
            /** Default Locale */
            default_locale: string | null;
            /** Endpoints Count */
            endpoints_count: number;
            /** Export Preset */
            export_preset: string | null;
            /** Monthly Cap Usd */
            monthly_cap_usd: number | null;
        };
        /** QueueJob */
        QueueJob: {
            /** Current Stage */
            current_stage: string;
            /** Eta Ms */
            eta_ms: number;
            /** Kit Id */
            kit_id: string;
            /** Locale */
            locale: string | null;
            /** Name */
            name: string | null;
            /** Sku */
            sku: string | null;
            /** Stages */
            stages: ("done" | "active" | "queued")[];
        };
        /** SaveEndpointsRequest */
        SaveEndpointsRequest: {
            /** Expected Sha256 */
            expected_sha256: string;
            /** New Yaml */
            new_yaml: string;
        };
        /** SaveEndpointsResponse */
        SaveEndpointsResponse: {
            /** New Sha256 */
            new_sha256: string;
            /**
             * Registry Rebooted
             * @default true
             */
            registry_rebooted: boolean;
            /** Warning */
            warning?: string | null;
        };
        /** SaveImageRequest */
        SaveImageRequest: {
            /** Edit Result Ref */
            edit_result_ref: string;
            /**
             * Mode
             * @enum {string}
             */
            mode: "replace" | "copy";
        };
        /** SaveImageResponse */
        SaveImageResponse: {
            /** Asset Id */
            asset_id?: number | null;
            /** Image Id */
            image_id: string;
            /** Image Url */
            image_url: string;
            /**
             * Mode
             * @enum {string}
             */
            mode: "replace" | "copy";
            /** Replaced */
            replaced: boolean;
        };
        /** SchemePayload */
        SchemePayload: {
            /** Description */
            description?: string | null;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Name */
            name: string;
            /** Slots */
            slots: components["schemas"]["SchemeSlot"][];
        };
        /** SchemeSlot */
        SchemeSlot: {
            /**
             * Slot Id
             * @enum {string}
             */
            slot_id: "H1" | "H2" | "H3" | "H4" | "H5" | "M1" | "M2" | "M3" | "M4" | "M5" | "M6" | "M7" | "M8" | "M9";
            /** Template Ref */
            template_ref: string;
        };
        /** SchemeSummary */
        SchemeSummary: {
            /** Description */
            description?: string | null;
            /**
             * Editable
             * @default true
             */
            editable: boolean;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /** Id */
            id: string;
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Name */
            name: string;
            /** Slots */
            slots: components["schemas"]["SchemeSlot"][];
            /**
             * Source
             * @default custom
             * @enum {string}
             */
            source: "built_in" | "custom";
        };
        /** SellingPointIn */
        SellingPointIn: {
            /** Evidence */
            evidence: string;
            /**
             * Priority
             * @enum {string}
             */
            priority: "high" | "medium" | "low";
            /** Title */
            title: string;
        };
        /**
         * SettingsResponse
         * @description Post-write snapshot of the 4 workspace-level fields.
         */
        SettingsResponse: {
            /** Brand Color */
            brand_color: string | null;
            /** Default Locale */
            default_locale: string | null;
            /** Export Preset */
            export_preset: string | null;
            /** Monthly Cap Usd */
            monthly_cap_usd: number | null;
        };
        /**
         * SettingsUpdate
         * @description All four fields optional — only the provided keys get merged.
         */
        SettingsUpdate: {
            /** Brand Color */
            brand_color?: string | null;
            /** Default Locale */
            default_locale?: ("zh" | "en") | null;
            /** Export Preset */
            export_preset?: string | null;
            /** Monthly Cap Usd */
            monthly_cap_usd?: number | null;
        };
        /** SkuMetaIn */
        SkuMetaIn: {
            /** Brand */
            brand: string;
            /** Category */
            category: string;
            /** Name */
            name?: string | null;
            /** Price */
            price: number;
            /**
             * Product Type
             * @enum {string}
             */
            product_type: "blue_hat" | "sports" | "general_food" | "other";
            /** Sku */
            sku?: string | null;
        };
        /** Sparks */
        Sparks: {
            /** Compliance */
            compliance: number[];
            /** Cost */
            cost: number[];
            /** Kits */
            kits: number[];
        };
        /** SpecIn */
        SpecIn: {
            /** Detail Sections */
            detail_sections: components["schemas"]["DetailSectionIn"][];
            /** Hero Sections */
            hero_sections: components["schemas"]["HeroSectionIn"][];
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Selling Points */
            selling_points: components["schemas"]["SellingPointIn"][];
            sku_meta: components["schemas"]["SkuMetaIn"];
        };
        /** SpecOut */
        SpecOut: {
            /** Detail Sections */
            detail_sections: components["schemas"]["DetailSectionOut"][];
            /** Hero Sections */
            hero_sections: components["schemas"]["HeroSectionOut"][];
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Selling Points */
            selling_points: components["schemas"]["SellingPointIn"][];
            sku_meta: components["schemas"]["SkuMetaIn"];
        };
        /** SpecRequest */
        SpecRequest: {
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Selling Points */
            selling_points: components["schemas"]["SellingPointIn"][];
            sku_meta: components["schemas"]["SkuMetaIn"];
        };
        /** SpecResponse */
        SpecResponse: {
            compliance: components["schemas"]["ComplianceOut"];
            spec: components["schemas"]["SpecOut"];
            /** Spec Markdown */
            spec_markdown: string;
        };
        /** StoreSecretRequest */
        StoreSecretRequest: {
            /** Api Key */
            api_key: string;
            /** Name */
            name: string;
            /** Role */
            role: string;
        };
        /** StoreSecretResponse */
        StoreSecretResponse: {
            /** Api Key Env */
            api_key_env: string;
        };
        /** TemplatePayload */
        TemplatePayload: {
            /**
             * Category
             * @default lifestyle
             * @enum {string}
             */
            category: "hero" | "detail_m3" | "lifestyle" | "short_video" | "amazon_hero";
            /** Category Tips */
            category_tips?: {
                [key: string]: string;
            };
            /** Defaults */
            defaults?: {
                [key: string]: string;
            };
            /** Description */
            description?: string | null;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /** Examples */
            examples?: string[];
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Name */
            name: string;
            /** Prompt Template */
            prompt_template: {
                [key: string]: string;
            };
            /**
             * Supports Image Reference
             * @default false
             */
            supports_image_reference: boolean;
            /** Tags */
            tags?: string[];
            /** Variants */
            variants?: {
                [key: string]: unknown;
            };
        };
        /** TemplateSummary */
        TemplateSummary: {
            /**
             * Category
             * @enum {string}
             */
            category: "hero" | "detail_m3" | "lifestyle" | "short_video" | "amazon_hero";
            /**
             * Copyable
             * @default true
             */
            copyable: boolean;
            /** Defaults */
            defaults?: {
                [key: string]: string;
            } | null;
            /** Description */
            description: string | null;
            /**
             * Editable
             * @default false
             */
            editable: boolean;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /** Examples */
            examples?: string[];
            /** Id */
            id: string;
            /**
             * Locale
             * @enum {string}
             */
            locale: "zh" | "en";
            /** Name */
            name: string;
            /** Name En */
            name_en?: string | null;
            /** Prompt Template */
            prompt_template?: {
                [key: string]: string;
            } | null;
            /**
             * Source
             * @default built_in
             * @enum {string}
             */
            source: "built_in" | "custom";
            /** Tags */
            tags: string[];
            /** Thumbnail Url */
            thumbnail_url: string | null;
        };
        /** TemplateUpdate */
        TemplateUpdate: {
            /** Category */
            category?: ("hero" | "detail_m3" | "lifestyle" | "short_video" | "amazon_hero") | null;
            /** Category Tips */
            category_tips?: {
                [key: string]: string;
            } | null;
            /** Defaults */
            defaults?: {
                [key: string]: string;
            } | null;
            /** Description */
            description?: string | null;
            /** Enabled */
            enabled?: boolean | null;
            /** Examples */
            examples?: string[] | null;
            /** Name */
            name?: string | null;
            /** Prompt Template */
            prompt_template?: {
                [key: string]: string;
            } | null;
            /** Supports Image Reference */
            supports_image_reference?: boolean | null;
            /** Tags */
            tags?: string[] | null;
            /** Variants */
            variants?: {
                [key: string]: unknown;
            } | null;
        };
        /** TextBoxOut */
        TextBoxOut: {
            /** Confidence */
            confidence: number;
            /** H */
            h: number;
            /** Text */
            text: string;
            /** W */
            w: number;
            /** X */
            x: number;
            /** Y */
            y: number;
        };
        /** ThreePieceIn */
        ThreePieceIn: {
            /** Copy */
            copy: string;
            /** Design Note */
            design_note: string;
            /** Visual */
            visual: string;
        };
        /**
         * ThreePieceOut
         * @description Output mirror of ThreePieceIn in kits.py.
         *
         *     Uses validation_alias + serialization_alias on ``copy_text`` so the public
         *     JSON key is ``copy`` (matching the SpecIn contract) while the Python
         *     field name avoids shadowing ``BaseModel.copy()``.
         */
        ThreePieceOut: {
            /** Copy */
            copy: string;
            /** Design Note */
            design_note: string;
            /** Visual */
            visual: string;
        };
        /** UpdateEndpointRequest */
        UpdateEndpointRequest: {
            /** Adapter */
            adapter?: string | null;
            /** Api Key */
            api_key?: string | null;
            /** Base Url */
            base_url: string;
            /** Model */
            model: string;
            /** Name */
            name: string;
            /**
             * Protocol
             * @enum {string}
             */
            protocol: "openai_compatible" | "anthropic_compatible" | "image_generation";
        };
        /** ValidationError */
        ValidationError: {
            /** Context */
            ctx?: Record<string, never>;
            /** Input */
            input?: unknown;
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
        };
        /** ViolationOut */
        ViolationOut: {
            /** Location */
            location: string;
            /** Matched Text */
            matched_text: string;
            /** Rule Id */
            rule_id: string;
            /**
             * Severity
             * @enum {string}
             */
            severity: "hard_block" | "warning" | "advisory";
            /** Suggestion */
            suggestion?: string | null;
        };
        /** WeeklyMetricsResponse */
        WeeklyMetricsResponse: {
            /** Api Spend Usd Mtd */
            api_spend_usd_mtd: number;
            /** Avg Compliance */
            avg_compliance: number | null;
            /** Avg Manual Edit Min */
            avg_manual_edit_min: number | null;
            /** Kits This Week */
            kits_this_week: number;
            sparks: components["schemas"]["Sparks"];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    image_bytes_api_images__image_id__bytes_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                image_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_edit_api_images__image_id__edit_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                image_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EditRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EditAccepted"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    edit_events_api_images__image_id__edit_events_get: {
        parameters: {
            query: {
                job_id: string;
            };
            header?: never;
            path: {
                image_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    ocr_image_api_images__image_id__ocr_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                image_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OcrResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_edited_image_api_images__image_id__save_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                image_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveImageRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveImageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_kits_api_kits_get: {
        parameters: {
            query?: {
                recent?: boolean;
                limit?: number;
                offset?: number;
                status?: string | null;
                locale?: string | null;
                min_score?: number | null;
                category?: string | null;
                sku?: string | null;
                sort?: "created_at" | "updated_at" | "score";
                order?: "asc" | "desc";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KitListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    warmup_extract_api_kits__warmup_extract_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    delete_generated_image_api_kits__db_kit_id__images__image_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                db_kit_id: number;
                image_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DeleteKitImageResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_kit_meta_api_kits__db_kit_id__meta_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                db_kit_id: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["KitMetaResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_kit_events_api_kits__kit_id__events_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kit_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    extract_api_kits__kit_id__extract_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kit_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExtractRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExtractResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    post_generate_api_kits__kit_id__generate_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kit_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerateResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_generated_image_api_kits__kit_id__images__image_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kit_id: string;
                image_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_spec_api_kits__kit_id__spec_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kit_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SpecRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SpecResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_weekly_metrics_api_metrics_weekly_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WeeklyMetricsResponse"];
                };
            };
        };
    };
    get_onboarding_needed_api_onboarding_needed_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OnboardingNeededResponse"];
                };
            };
        };
    };
    get_config_state_api_providers_config_state_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigStateResponse"];
                };
            };
        };
    };
    save_endpoints_api_providers_endpoints_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveEndpointsRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveEndpointsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_endpoint_api_providers_endpoints__role__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EndpointStanza"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_endpoint_api_providers_endpoints__role__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UpdateEndpointRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveEndpointsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_endpoint_api_providers_endpoints__role__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateEndpointRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveEndpointsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_endpoint_api_providers_endpoints__role__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SaveEndpointsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_endpoint_secret_api_providers_endpoints__role__secret_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                role: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EndpointSecretResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_provider_health_api_providers_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderHealthRow"][];
                };
            };
        };
    };
    list_provider_models_api_providers_models_get: {
        parameters: {
            query?: {
                role?: string | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProviderProbeResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    probe_candidate_api_providers_probe_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ProbeCandidateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProbeCandidateResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    store_secret_api_providers_secrets_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["StoreSecretRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreSecretResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_provider_summary_api_providers_summary_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProvidersSummaryResponse"];
                };
            };
        };
    };
    get_active_queue_api_queue_active_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueJob"][];
                };
            };
        };
    };
    post_settings_api_settings_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SettingsUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_templates_api_templates_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateSummary"][];
                };
            };
        };
    };
    create_template_api_templates_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TemplatePayload"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    copy_template_api_templates_copy_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CopyTemplateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_managed_templates_api_templates_managed_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateSummary"][];
                };
            };
        };
    };
    preview_template_api_templates_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PreviewRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PreviewResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_schemes_api_templates_schemes_get: {
        parameters: {
            query?: {
                locale?: "zh" | "en";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeSummary"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_scheme_api_templates_schemes_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchemePayload"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchemeSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_template_api_templates__template_ref__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                template_ref: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_template_api_templates__template_ref__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                template_ref: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TemplateUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TemplateSummary"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
        };
    };
}

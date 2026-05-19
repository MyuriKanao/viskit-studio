/** Spec L42 — confidence threshold below which a field renders a reverse-question
 *  in the ConfirmationCard. Single tuning surface (MED-4). Revisit after dogfooding. */
export const LOW_CONF_THRESHOLD = 0.6;

/** FE upload size cap (8 MB). Backend has an independent 12 MB guard via
 *  ExtractRequest.image_url Field(max_length=12_000_000) (MED-1 / R8). */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

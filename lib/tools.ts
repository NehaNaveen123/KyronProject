/**
 * Re-exports the canonical booking functions so any legacy import of
 * lib/tools still resolves correctly.  The implementation now lives in
 * lib/booking, which is the single source of truth for availability
 * queries, slot formatting, and appointment creation.
 */
export { getAvailability, bookAppointment } from './booking';

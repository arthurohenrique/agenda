import { conversationContextSchema } from "../domain/conversation";

export function projectWhatsAppConversationContext(context: unknown) {
  const parsed = conversationContextSchema.safeParse(context);
  if (!parsed.success) return null;

  const value = parsed.data;
  return {
    locale: value.locale,
    bookingDraft: {
      operation: value.booking.operation,
      serviceName: value.booking.serviceName,
      staffName: value.booking.staffName,
      date: value.booking.date,
      startsAt: value.booking.startsAt,
      endsAt: value.booking.endsAt,
      customerName: value.booking.customerName,
      customerEmail: value.booking.customerEmail,
      notes: value.booking.notes,
    },
    searchQuery: value.routing.searchQuery,
    handoff: value.handoff
      ? { reason: value.handoff.reason, requestedBy: value.handoff.requestedBy }
      : null,
  };
}

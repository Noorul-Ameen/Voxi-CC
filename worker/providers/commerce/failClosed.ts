/** Fail-closed implementations of every protected commerce capability.
 *
 * These are the ACTIVE implementations whenever genuine VOX partner API
 * credentials (VOX_PARTNER_API_BASE_URL + VOX_API_KEY + VOX_CLIENT_SECRET)
 * are not configured. They never report success, never return plausible
 * fake data, and clearly identify the capability as requiring an official
 * VOX integration.
 *
 * When MAF/Apigee partner credentials become available, implement
 * `VistaConnectCommerceProvider` against the documented endpoints in
 * docs/VOX_API.md and swap it in via worker/providers/registry.ts —
 * no frontend or conversation-engine change required.
 */

import type { CommerceResult } from '@shared/models';
import type {
  BookingProvider,
  CancellationProvider,
  FoodProvider,
  LoyaltyProvider,
  PaymentProvider,
  PricingProvider,
  RefundProvider,
  SeatProvider,
  TicketProvider,
} from '../types';

function unavailable<T>(capability: string): CommerceResult<T> {
  return {
    status: 'unavailable',
    reason:
      `${capability} requires the official VOX partner API (Vista Connect via MAF Apigee), ` +
      'which is not configured in this environment. This operation is fail-closed: ' +
      'no simulated result is produced.',
    retryable: false,
  };
}

export class FailClosedCommerceProvider
  implements
    TicketProvider,
    SeatProvider,
    FoodProvider,
    PricingProvider,
    LoyaltyProvider,
    PaymentProvider,
    BookingProvider,
    CancellationProvider,
    RefundProvider
{
  async getTicketTypes(): Promise<CommerceResult<never[]>> {
    return unavailable('Ticket type lookup');
  }
  async getSeatLayout(): Promise<CommerceResult<never>> {
    return unavailable('Seat layout / availability');
  }
  async lockSeats(): Promise<CommerceResult<never>> {
    return unavailable('Seat locking');
  }
  async getFoodItems(): Promise<CommerceResult<never[]>> {
    return unavailable('Food & beverage catalogue');
  }
  async getOrderTotal(): Promise<CommerceResult<never>> {
    return unavailable('Order pricing');
  }
  async getBalance(): Promise<CommerceResult<never>> {
    return unavailable('Loyalty balance');
  }
  async redeem(): Promise<CommerceResult<never>> {
    return unavailable('Loyalty redemption');
  }
  async pay(): Promise<CommerceResult<never>> {
    return unavailable('Payment');
  }
  async createBooking(): Promise<CommerceResult<never>> {
    return unavailable('Booking');
  }
  async getBookingHistory(): Promise<CommerceResult<never[]>> {
    return unavailable('Booking history');
  }
  async cancelBooking(): Promise<CommerceResult<never>> {
    return unavailable('Cancellation');
  }
  async refundBooking(): Promise<CommerceResult<never>> {
    return unavailable('Refund');
  }
}

export interface User {
  id: string;
  name: string;
  phone: string;
  email: string;
  type: "customer";
  gender?: "male" | "female";
  city: string;
  district: string;
  avatar?: string;
  oauthProvider?: "google" | "apple";
  oauthProviderId?: string;
  referralCode: string;
  referredBy?: string;
  freeRidesRemaining: number;
  createdAt: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string;
  type: "driver";
  driverCategory?: "driver" | "scooter" | "courier";
  vehiclePlate: string;
  vehicleModel: string;
  vehicleColor: string;
  rating: number;
  totalRides: number;
  isOnline: boolean;
  isSuspended?: boolean;
  isApproved?: boolean;
  approvedAt?: string;
  licenseIssueDate?: string;
  partnerDriverName?: string;
  dailyEarnings: number;
  weeklyEarnings: number;
  monthlyEarnings: number;
  city: string;
  district: string;
  avatar?: string;
  createdAt: string;
}

export interface BusinessMenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
}

export interface BusinessOrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Business {
  id: string;
  ownerDriverId: string;
  name: string;
  website: string;
  image: string;
  description: string;
  category: string;
  city: string;
  district: string;
  address: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  rating: number;
  reviewCount: number;
  deliveryTime: string;
  deliveryFee: number;
  minOrder: number;
  menu: BusinessMenuItem[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Ride {
  id: string;
  customerId: string;
  customerName: string;
  driverId: string;
  driverName: string;
  driverRating: number;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  status: "pending" | "accepted" | "in_progress" | "completed" | "cancelled";
  price: number;
  distance: string;
  duration: string;
  createdAt: string;
  completedAt?: string;
  cancelledBy?: "customer" | "driver";
  cancelReason?: string;
  cancelledAt?: string;
  cancellationFee?: number;
  paymentMethod: "cash" | "card";
  paymentStatus?: "pending" | "paid" | "failed";
  isFreeRide: boolean;
  city: string;
  district?: string;
  requestedDriverCategory?: "driver" | "scooter" | "courier";
  notifiedDriverIds?: string[];
  rejectedDriverIds?: string[];
  queuedForDriverId?: string;
  queuedForDriverName?: string;
  queuedEstimatedAvailabilityMinutes?: number;
  queuedAt?: string;
  rideForOther?: boolean;
  recipientName?: string;
  recipientPhone?: string;
  recipientRelation?: string;
  guestPaymentMode?: "customer_app" | "guest_in_car";
  guestTrackingEnabled?: boolean;
  orderType?: "ride" | "business_delivery" | "custom_delivery";
  businessId?: string;
  businessName?: string;
  businessImage?: string;
  businessWebsite?: string;
  orderItems?: BusinessOrderItem[];
  orderNote?: string;
  assignedCourierId?: string;
  courierRequestExpiresAt?: string;
  courierDispatchedAt?: string;
  courierAttemptedDriverIds?: string[];
  courierRejectedDriverIds?: string[];
  maxCourierDistanceKm?: number;
}

export interface Payment {
  token: string;
  rideId: string;
  customerId: string;
  conversationId: string;
  amount: number;
  status: "pending" | "completed" | "failed";
  paymentId?: string;
  createdAt: string;
}

export interface Rating {
  id: string;
  rideId: string;
  customerId: string;
  driverId: string;
  stars: number;
  comment: string;
  createdAt: string;
}

export interface Message {
  id: string;
  rideId: string;
  senderId: string;
  senderName: string;
  senderType: "customer" | "driver";
  text: string;
  createdAt: string;
}

export interface Session {
  token: string;
  userId: string;
  userType: "customer" | "driver";
  createdAt: string;
  expiresAt: string;
}

export interface PushToken {
  userId: string;
  token: string;
  platform: "ios" | "android" | "web";
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  createdAt: string;
}

export interface Referral {
  id: string;
  referrerUserId: string;
  referredUserId: string;
  referredName: string;
  freeRidesAwarded: number;
  createdAt: string;
}

export interface DriverDocuments {
  driverId: string;
  licenseFront?: string;
  licenseBack?: string;
  idCardFront?: string;
  idCardBack?: string;
  registrationFront?: string;
  registrationBack?: string;
  criminalRecord?: string;
  taxCertificate?: string;
  uploadedAt: string;
}

const IYZICO_BASE_URL = process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com';
const IYZICO_API_KEY = process.env.IYZICO_API_KEY || '';
const IYZICO_SECRET_KEY = process.env.IYZICO_SECRET_KEY || '';

function generatePkiString(obj: Record<string, unknown>): string {
  let result = '[';
  const entries = Object.entries(obj);
  let first = true;
  for (let i = 0; i < entries.length; i++) {
    const [key, value] = entries[i];
    if (value === null || value === undefined) continue;
    if (!first) result += ',';
    first = false;
    if (Array.isArray(value)) {
      result += `${key}=[`;
      for (let j = 0; j < value.length; j++) {
        if (typeof value[j] === 'object' && value[j] !== null) {
          result += generatePkiString(value[j] as Record<string, unknown>);
        } else {
          result += String(value[j]);
        }
        if (j < value.length - 1) result += ', ';
      }
      result += ']';
    } else if (typeof value === 'object') {
      result += `${key}=${generatePkiString(value as Record<string, unknown>)}`;
    } else {
      result += `${key}=${value}`;
    }
  }
  result += ']';
  return result;
}

async function sha1Base64(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-1', dataBuffer);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  return btoa(binary);
}

async function generateAuthorizationHeader(request: Record<string, unknown>): Promise<{ authorization: string; randomKey: string }> {
  const randomKey = Date.now().toString(36) + Math.random().toString(36).substring(2, 10);
  const pkiString = generatePkiString(request);
  const hashStr = await sha1Base64(IYZICO_API_KEY + randomKey + IYZICO_SECRET_KEY + pkiString);
  const authorization = `IYZWS ${IYZICO_API_KEY}:${hashStr}`;
  console.log('[IYZICO] Generated auth header for request');
  return { authorization, randomKey };
}

export interface IyzicoCheckoutFormRequest {
  locale: string;
  conversationId: string;
  price: string;
  paidPrice: string;
  currency: string;
  basketId: string;
  paymentGroup: string;
  callbackUrl: string;
  buyer: {
    id: string;
    name: string;
    surname: string;
    gsmNumber: string;
    email: string;
    identityNumber: string;
    registrationAddress: string;
    ip: string;
    city: string;
    country: string;
  };
  shippingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  billingAddress: {
    contactName: string;
    city: string;
    country: string;
    address: string;
  };
  basketItems: Array<{
    id: string;
    name: string;
    category1: string;
    itemType: string;
    price: string;
  }>;
}

export interface IyzicoCheckoutFormResponse {
  status: string;
  errorCode?: string;
  errorMessage?: string;
  errorGroup?: string;
  locale: string;
  systemTime: number;
  conversationId: string;
  token?: string;
  checkoutFormContent?: string;
  tokenExpireTime?: number;
  paymentPageUrl?: string;
}

export interface IyzicoPaymentDetailResponse {
  status: string;
  errorCode?: string;
  errorMessage?: string;
  locale: string;
  systemTime: number;
  conversationId: string;
  paymentId?: string;
  price?: number;
  paidPrice?: number;
  paymentStatus?: string;
  token?: string;
  fraudStatus?: number;
  cardAssociation?: string;
  cardFamily?: string;
  lastFourDigits?: string;
}

export async function initializeCheckoutForm(request: IyzicoCheckoutFormRequest): Promise<IyzicoCheckoutFormResponse> {
  const uri = '/payment/iyzipos/checkoutform/initialize/auth/ecom';
  const requestBody = request as unknown as Record<string, unknown>;
  const { authorization, randomKey } = await generateAuthorizationHeader(requestBody);

  console.log('[IYZICO] Initializing checkout form, conversationId:', request.conversationId);

  const response = await fetch(`${IYZICO_BASE_URL}${uri}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authorization,
      'x-iyzi-rnd': randomKey,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json() as IyzicoCheckoutFormResponse;
  console.log('[IYZICO] Checkout form response status:', data.status);
  if (data.errorMessage) {
    console.log('[IYZICO] Error:', data.errorCode, data.errorMessage);
  }
  return data;
}

export async function retrieveCheckoutFormResult(token: string, conversationId: string): Promise<IyzicoPaymentDetailResponse> {
  const uri = '/payment/iyzipos/checkoutform/auth/ecom/detail';
  const requestBody: Record<string, unknown> = {
    locale: 'tr',
    conversationId,
    token,
  };
  const { authorization, randomKey } = await generateAuthorizationHeader(requestBody);

  console.log('[IYZICO] Retrieving checkout form result, token:', token.substring(0, 20) + '...');

  const response = await fetch(`${IYZICO_BASE_URL}${uri}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authorization,
      'x-iyzi-rnd': randomKey,
    },
    body: JSON.stringify(requestBody),
  });

  const data = await response.json() as IyzicoPaymentDetailResponse;
  console.log('[IYZICO] Payment detail response status:', data.status, 'paymentStatus:', data.paymentStatus);
  return data;
}

export function isIyzicoConfigured(): boolean {
  return IYZICO_API_KEY.length > 0 && IYZICO_SECRET_KEY.length > 0;
}

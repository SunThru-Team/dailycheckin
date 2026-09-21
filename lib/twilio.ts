import twilio from 'twilio';
import { env } from './env';

let _client: ReturnType<typeof twilio> | undefined;
export function twilioClient() {
  if (!_client) _client = twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
  return _client;
}

export const baseUrl = () => env('PUBLIC_BASE_URL').replace(/\/$/, '');

/**
 * Verify X-Twilio-Signature. Twilio signs the *public* URL it hit (including query string)
 * plus the form params, so we rebuild that URL from PUBLIC_BASE_URL rather than trusting
 * req.url, which behind Vercel's proxy may differ from what Twilio saw.
 */
export function verifyTwilioRequest(req: Request, params: Record<string, string>): boolean {
  if (process.env.TWILIO_VALIDATE_SIGNATURE === 'false') return true;
  const sig = req.headers.get('x-twilio-signature') ?? '';
  const incoming = new URL(req.url);
  const url = baseUrl() + incoming.pathname + incoming.search;
  return twilio.validateRequest(env('TWILIO_AUTH_TOKEN'), sig, url, params);
}

export async function formParams(req: Request): Promise<Record<string, string>> {
  const form = await req.formData();
  const out: Record<string, string> = {};
  form.forEach((v, k) => { out[k] = v.toString(); });
  return out;
}

export function twimlResponse(twiml: { toString(): string }) {
  return new Response(twiml.toString(), { headers: { 'Content-Type': 'text/xml' } });
}

/** Place a check-in call for an existing calls row. Returns the Twilio CallSid. */
export async function placeCheckinCall(callId: number, to: string): Promise<string> {
  const call = await twilioClient().calls.create({
    to,
    from: env('TWILIO_FROM_NUMBER'),
    url: `${baseUrl()}/api/voice?callId=${callId}`,
    method: 'POST',
    statusCallback: `${baseUrl()}/api/status?kind=checkin`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    machineDetection: 'Enable',        // hang up on voicemail rather than dictating the prompt into it
    timeout: 25,
  });
  return call.sid;
}

/** Place the evening briefing call to the CEO for an existing ceo_calls row. */
export async function placeCeoCall(ceoCallId: number): Promise<string> {
  const call = await twilioClient().calls.create({
    to: env('CEO_PHONE_NUMBER'),
    from: env('TWILIO_FROM_NUMBER'),
    url: `${baseUrl()}/api/ceo-voice?id=${ceoCallId}`,
    method: 'POST',
    statusCallback: `${baseUrl()}/api/status?kind=ceo`,
    statusCallbackMethod: 'POST',
    statusCallbackEvent: ['completed'],
    timeout: 30,
  });
  return call.sid;
}

export const CHECKIN_PROMPT =
  'Hello, this is your daily check-in. In your own words, tell me what you worked on today, ' +
  'whether there were any major blockers, what is still outstanding, and what you need in order ' +
  'to move forward. Take as long as you like, and press the pound key when you are finished. ' +
  'Please begin after the tone.';

/** Shared <Gather> settings for the open-ended answer: speech, plus # to finish. */
export const GATHER_OPTS = {
  input: ['speech', 'dtmf'] as ('speech' | 'dtmf')[],
  speechTimeout: 'auto',
  speechModel: 'phone_call' as const,
  enhanced: true,
  timeout: 8,
  numDigits: 1,
  finishOnKey: '',          // so pressing # arrives as Digits="#" instead of silently ending
  actionOnEmptyResult: true,
  method: 'POST' as const,
};
/** Hard ceilings so a stuck line can't talk forever. */
export const MAX_SEGMENTS = 30;
export const MAX_SILENT_SEGMENTS = 2;

export const VOICE = { voice: 'Polly.Joanna-Neural' as const, language: 'en-US' as const };

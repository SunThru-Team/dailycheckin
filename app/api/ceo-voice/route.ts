// TwiML for the CEO briefing call: read the stored summary aloud, offer a repeat.
import twilio from 'twilio';
import { getCeoCall } from '@/lib/db';
import { fmtDate } from '@/lib/time';
import { VOICE, formParams, twimlResponse, verifyTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
const { VoiceResponse } = twilio.twiml;

export async function POST(req: Request) {
  const params = await formParams(req);
  if (!verifyTwilioRequest(req, params)) return new Response('Invalid signature', { status: 403 });

  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  const repeat = url.searchParams.get('repeat') === '1';
  const twiml = new VoiceResponse();

  const row = Number.isFinite(id) ? await getCeoCall(id) : null;
  if (!row) {
    twiml.say(VOICE, 'Sorry, no briefing was found for today. Goodbye.');
    twiml.hangup();
    return twimlResponse(twiml);
  }

  if (repeat && params.Digits !== '1') { twiml.say(VOICE, 'Goodbye.'); twiml.hangup(); return twimlResponse(twiml); }

  if (!repeat) twiml.say(VOICE, `Here is your team briefing for ${fmtDate(row.call_date)}.`);
  twiml.pause({ length: 1 });
  // <Say> caps text at ~4,096 chars; the summary is prompted to stay well under.
  twiml.say(VOICE, row.summary_text.slice(0, 4000));
  twiml.pause({ length: 1 });

  const gather = twiml.gather({ numDigits: 1, timeout: 5, action: `/api/ceo-voice?id=${id}&repeat=1`, method: 'POST' });
  gather.say(VOICE, 'Press one to hear that again, or hang up. The full text is on your dashboard.');
  twiml.say(VOICE, 'Goodbye.');
  return twimlResponse(twiml);
}

// Twilio call-status callbacks for both employee check-ins and the CEO briefing.
import { updateCallStatusBySid, updateCeoCallStatusBySid } from '@/lib/db';
import { formParams, verifyTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const params = await formParams(req);
  if (!verifyTwilioRequest(req, params)) return new Response('Invalid signature', { status: 403 });

  const kind = new URL(req.url).searchParams.get('kind') ?? 'checkin';
  const sid = params.CallSid;
  let status = params.CallStatus;
  if (!sid || !status) return new Response('Missing CallSid/CallStatus', { status: 400 });

  // A call answered by voicemail counts as missed for rescheduling purposes.
  if (status === 'completed' && params.AnsweredBy?.startsWith('machine')) status = 'no-answer';

  if (kind === 'ceo') await updateCeoCallStatusBySid(sid, status);
  else await updateCallStatusBySid(sid, status);

  return new Response(null, { status: 204 });
}

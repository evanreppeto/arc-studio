export type ThreadTurn = { role: string; body: string; status: string };

/**
 * Has Arc answered the operator's most recent message?
 *
 * This used to be decided by comparing each row's server `createdAt` against a
 * timestamp the BROWSER stamped after the send action returned. Those are two
 * different clocks. Whenever the client's ran ahead of the database's — ordinary
 * skew, or simply the runner creating the reply row before the send round-trip
 * finished — no reply ever satisfied `createdAt >= sentAt`, so the panel stayed
 * in "waiting" forever: the finished reply rendered from the thread AND a second
 * identical copy rendered in the live streaming bubble, until the 2-minute
 * timeout finally gave up. That is the duplicated answer operators were seeing.
 *
 * Position in the returned tail answers the same question without a clock: the
 * tail is ordered, so an Arc message that appears AFTER the last operator
 * message is a reply to it.
 */
export function hasRepliedToLastMessage(messages: ThreadTurn[]): boolean {
  let lastOperator = -1;
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role === "operator") lastOperator = i;
  }
  // No operator message in the tail means nothing is being waited on here.
  if (lastOperator === -1) return false;
  return messages.some(
    (m, i) => i > lastOperator && m.role !== "operator" && m.status !== "pending" && m.body.trim().length > 0,
  );
}

/**
 * Analyzes the conversation contents to determine if it's the user's turn
 * and calculates the current turn index.
 */
export function analyzeTurn(contents: any[]) {
  const lastMessage = contents[contents.length - 1];
  const isUserTurn = lastMessage?.role === 'user' && lastMessage.parts?.some((p: any) => 'text' in p);
  const userTurns = contents.filter((m: any) => m.role === 'user' && m.parts?.some((p: any) => 'text' in p)).length;
  const turn = Math.max(0, userTurns - 1);
  
  return { isUserTurn, turn };
}

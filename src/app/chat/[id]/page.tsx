import ChatComponent from '../_components/ChatComponent';

export default async function ChatSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <ChatComponent chatId={resolvedParams.id} />;
}

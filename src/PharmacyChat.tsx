import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { get, post } from "./api";
import { Alert, Badge, Empty, Loading, Modal, Panel, fmtDateTime, useLoad } from "./ui";

type PharmacyMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  text: string;
  createdAt: string;
};

type PharmacyChat = {
  id: string;
  pharmacyName: string;
  patientName: string;
  messages: PharmacyMessage[];
};

export function PharmacyConversation({ chatId, title, onClose }: { chatId: string; title: string; onClose: () => void }) {
  const [chat, setChat] = useState<PharmacyChat | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const result = await get<{ chat: PharmacyChat }>(`/pharmacy-chats/${encodeURIComponent(chatId)}`);
      setChat(result.chat);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't load this conversation.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [chatId]);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [chat?.messages.length]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    try {
      const result = await post<{ chat: PharmacyChat }>(`/pharmacy-chats/${encodeURIComponent(chatId)}/messages`, { text: message });
      setChat(result.chat);
      setText("");
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't send your message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose} className="pharmacy-chat-modal">
      <div className="pharmacy-chat">
        <div className="pharmacy-chat-messages" ref={messagesRef} aria-live="polite" aria-label="Conversation messages">
          {loading && !chat ? <Loading label="Loading conversation…" /> : chat?.messages.length ? chat.messages.map((message) => (
            <article key={message.id} className={`pharmacy-chat-message ${message.senderRole === "patient" ? "sent" : "received"}`}>
              <strong>{message.senderName}</strong>
              <p>{message.text}</p>
              <time>{fmtDateTime(message.createdAt)}</time>
            </article>
          )) : <Empty icon={<MessageSquare size={20} />} title="Start the conversation" text="Messages are saved so you can continue this chat later." />}
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <form className="pharmacy-chat-form" onSubmit={send}>
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={2000} placeholder="Write a message…" required />
          <button className="button" type="submit" disabled={sending || !text.trim()}><Send size={15} /> Send</button>
        </form>
      </div>
    </Modal>
  );
}

export function PharmacyChats() {
  const list = useLoad(() => get<{ chats: Array<{ id: string; pharmacyName: string; patientName: string; updatedAt: string; unreadCount: number }> }>("/pharmacy-chats"), []);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => list.reload(), 15000);
    return () => window.clearInterval(timer);
  }, [list.reload]);

  return (
    <Panel title="Customer messages">
      {list.loading && !list.data ? <Loading /> : list.error ? <Alert kind="error">{list.error}</Alert> : !list.data?.chats.length ? (
        <Empty icon={<MessageSquare size={22} />} title="No customer messages" text="Patient messages to your shop will appear here. You can reply and continue each conversation from this page." />
      ) : (
        <ul className="list">
          {list.data.chats.map((chat) => (
            <li key={chat.id}>
              <div>
                <strong>{chat.patientName}</strong>
                <small>{chat.pharmacyName} · updated {fmtDateTime(chat.updatedAt)}</small>
              </div>
              <div className="row-actions">
                {chat.unreadCount > 0 && <Badge tone="good">{chat.unreadCount} new</Badge>}
                <button className="outline-button button-small" onClick={() => setSelected({ id: chat.id, name: chat.patientName })}>Reply</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {selected && <PharmacyConversation chatId={selected.id} title={`Chat with ${selected.name}`} onClose={() => { setSelected(null); list.reload(); }} />}
    </Panel>
  );
}

export function PatientPharmacyChats() {
  const list = useLoad(() => get<{ chats: Array<{ id: string; pharmacyName: string; updatedAt: string; unreadCount: number }> }>("/pharmacy-chats"), []);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => list.reload(), 15000);
    return () => window.clearInterval(timer);
  }, [list.reload]);

  return (
    <Panel title="Your shop messages">
      {list.loading && !list.data ? <Loading /> : list.error ? <Alert kind="error">{list.error}</Alert> : !list.data?.chats.length ? (
        <Empty icon={<MessageSquare size={20} />} title="No shop conversations" text="Messages you send to registered pharmacies are saved here so you can continue the conversation later." />
      ) : (
        <ul className="list">
          {list.data.chats.map((chat) => (
            <li key={chat.id}>
              <div>
                <strong>{chat.pharmacyName}</strong>
                <small>Updated {fmtDateTime(chat.updatedAt)}</small>
              </div>
              <div className="row-actions">
                {chat.unreadCount > 0 && <Badge tone="good">{chat.unreadCount} new</Badge>}
                <button className="outline-button button-small" onClick={() => setSelected({ id: chat.id, name: chat.pharmacyName })}>Continue chat</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {selected && <PharmacyConversation chatId={selected.id} title={`Message ${selected.name}`} onClose={() => { setSelected(null); list.reload(); }} />}
    </Panel>
  );
}

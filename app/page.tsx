"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import {
  HubConnection,
  HubConnectionBuilder,
  LogLevel,
} from "@microsoft/signalr";
import axios from "axios";
import { Send, LogOut, Bot, Search, ShoppingCart } from "lucide-react";

const API_URL = "http://localhost:8080"; // Đổi port nếu API Gateway chạy port khác

// Định nghĩa một Type an toàn để thay thế cho chữ 'any'
type CustomSession = {
  accessToken?: string;
  user?: {
    name?: string | null;
  };
};

export default function Home() {
  const { data: session, status } = useSession();
  const [connection, setConnection] = useState<HubConnection | null>(null);
  const [messages, setMessages] = useState<{ sender: string; content: string }[]>([]);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Cuộn xuống dòng tin nhắn cuối
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Khởi tạo SignalR an toàn
  useEffect(() => {
    let currentConnection: HubConnection | null = null;
    
    // FIX LỖI 1 & 3: Ép kiểu rõ ràng thay vì dùng 'any' và kiểm tra an toàn
    const safeSession = session as CustomSession | null;
    const token = safeSession?.accessToken;

    if (token) {
      currentConnection = new HubConnectionBuilder()
        .withUrl(`${API_URL}/hubs/chat`, {
          accessTokenFactory: () => token,
        })
        .configureLogging(LogLevel.Information)
        .withAutomaticReconnect()
        .build();

      // Start kết nối bất đồng bộ
      currentConnection
        .start()
        .then(() => {
          console.log("🟢 Đã kết nối SignalR thành công!");
          currentConnection?.on(
            "ReceiveMessage",
            (senderName: string, content: string) => {
              setMessages((prev) => [...prev, { sender: senderName, content }]);
            }
          );
          setConnection(currentConnection);
        })
        .catch((e) => console.log("🔴 Lỗi kết nối SignalR: ", e));
    }

    // Cleanup: Ngắt kết nối khi component bị hủy
    return () => {
      if (currentConnection) {
        currentConnection.stop();
      }
    };
  }, [session]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // FIX LỖI 1 & 3: Ép kiểu rõ ràng
    const safeSession = session as CustomSession | null;
    const token = safeSession?.accessToken;

    if (!inputText.trim() || !token) return;

    // FIX LỖI 2: Dùng optional chaining (?.) cho session
    const myName = safeSession?.user?.name || "Tôi";
    setMessages((prev) => [...prev, { sender: myName, content: inputText }]);

    const textToSend = inputText;
    setInputText("");

    try {
      await axios.post(
        `${API_URL}/api/messages`,
        {
          conversationId: "test-conversation-id",
          content: textToSend,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    } catch (error) {
      console.error("Lỗi khi gửi tin nhắn:", error);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center font-semibold">
        Đang tải cấu hình...
      </div>
    );
  }

  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 flex-col gap-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-blue-600 mb-2">Hệ thống Chat AI</h1>
          <p className="text-gray-500">Đồ án tốt nghiệp: Tích hợp Semantic Search & Data Mining</p>
        </div>
        <button
          onClick={() => signIn("keycloak")}
          className="bg-blue-600 text-white px-8 py-3 rounded-xl shadow-lg hover:bg-blue-700 transition font-semibold text-lg"
        >
          Đăng nhập bằng Keycloak
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 p-2 gap-2 text-sm">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-gray-200">
        <p className="font-semibold text-gray-700">
          {/* FIX LỖI 2: Thêm dấu ? để tránh lỗi khi session chưa sẵn sàng */}
          Tài khoản: <span className="text-blue-600">{session?.user?.name}</span>
        </p>
        <button
          onClick={() => signOut()}
          title="Đăng xuất"
          aria-label="Đăng xuất"
          className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg flex items-center gap-2 transition font-medium"
        >
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>

      {/* Main Content (3 Columns) */}
      <div className="flex flex-1 gap-2 overflow-hidden">
        {/* CỘT 1: AI Tools */}
        <div className="w-1/4 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col p-4">
          <h2 className="font-bold text-base mb-4 text-gray-800 flex items-center gap-2">
            <Bot size={20} className="text-indigo-600" /> Khám phá AI
          </h2>

          <div className="flex flex-col gap-3">
            <button className="flex items-center gap-2 w-full bg-indigo-50 border border-indigo-100 text-indigo-700 p-3 rounded-lg font-medium hover:bg-indigo-100 transition text-left">
              <Bot size={18} />
              Tóm tắt tin nhắn chưa đọc
            </button>
            <button className="flex items-center gap-2 w-full bg-teal-50 border border-teal-100 text-teal-700 p-3 rounded-lg font-medium hover:bg-teal-100 transition text-left">
              <Search size={18} />
              Tìm kiếm ngữ nghĩa (Hybrid)
            </button>
          </div>
        </div>

        {/* CỘT 2: Chat Box */}
        <div className="w-2/4 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col relative overflow-hidden">
          <div className="bg-white border-b p-3 font-bold text-gray-800 flex justify-center items-center shadow-sm z-10">
            Phòng Chat Chung (Demo SignalR)
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-50/50">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 mt-10 italic">Hãy bắt đầu gửi tin nhắn...</div>
            )}
            {messages.map((msg, idx) => {
              // FIX LỖI 2: Dùng ?.
              const isMe = msg.sender === (session?.user?.name || "Tôi");
              return (
                <div key={idx} className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}>
                  <span className="text-xs text-gray-400 mb-1 mx-1 font-medium">{msg.sender}</span>
                  <div
                    className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-[15px] leading-relaxed ${
                      isMe
                        ? "bg-blue-600 text-white rounded-br-sm shadow-sm"
                        : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm shadow-sm"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <form onSubmit={handleSendMessage} className="p-3 bg-white border-t flex gap-2 items-center">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Nhập tin nhắn..."
              className="flex-1 border border-gray-300 p-2.5 rounded-full px-5 focus:outline-none focus:ring-2 focus:ring-blue-500/50 bg-gray-50 transition"
            />
            <button
              type="submit"
              title="Gửi tin nhắn"
              aria-label="Gửi tin nhắn"
              className="bg-blue-600 text-white p-2.5 w-11 h-11 flex items-center justify-center rounded-full hover:bg-blue-700 shadow-sm transition"
            >
              <Send size={18} />
            </button>
          </form>
        </div>

        {/* CỘT 3: Ads Recommendation */}
        <div className="w-1/4 bg-yellow-50/50 rounded-xl shadow-sm border border-yellow-200 flex flex-col p-4">
          <h2 className="font-bold text-base mb-4 text-yellow-800 flex items-center gap-2">
            <ShoppingCart size={20} /> Gợi ý Mua sắm (Ads)
          </h2>
          <div className="flex-1 border-2 border-dashed border-yellow-300 rounded-xl flex flex-col items-center justify-center text-yellow-600 p-6 bg-white/50 text-center gap-3">
            <ShoppingCart size={32} className="opacity-50" />
            <p className="font-medium">Quảng cáo dựa trên luật Apriori sẽ xuất hiện tại đây!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
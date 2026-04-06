"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import {
  HubConnection,
  HubConnectionBuilder,
  LogLevel,
} from "@microsoft/signalr";
import axios from "axios";
import {
  Send,
  LogOut,
  Search,
  ShoppingCart,
  MessageSquare,
  Plus,
  Sparkles,
  X,
  Loader2,
  Zap,
} from "lucide-react";

// Đảm bảo chạy HTTP port 8081 của YARP Gateway
const API_URL = "http://localhost:8081";

type CustomSession = {
  accessToken?: string;
  user?: { id?: string; name?: string | null };
};

interface ConversationDto {
  id: string;
  name: string;
  type: number;
}
interface MessageDto {
  id: string;
  conversationId: string;
  senderId?: string;
  content: string;
  createdAt?: string;
}
interface SearchResultDto {
  anchorMessage?: {
    id: string;
    conversationId: string;
    senderId?: string;
    content: string;
    createdAtUtc?: string;
  };
  conversationId?: string;
  relevanceScore?: number;
  surroundingMessages?: {
    id: string;
    conversationId: string;
    senderId?: string;
    content: string;
    createdAtUtc?: string;
  }[];
}

interface AdRuleDto {
  antecedents: string[];
  consequent: {
    title: string;
    desc: string;
    keyword: string;
  };
}
export default function Home() {
  const { data: session, status } = useSession();
  const safeSession = session as CustomSession | null;
  const token = safeSession?.accessToken;
  const myUserId = safeSession?.user?.id;

  const [connection, setConnection] = useState<HubConnection | null>(null);

  // --- CHAT STATES ---
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // --- AI STATES ---
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryResult, setSummaryResult] = useState<string | null>(null);

  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultDto[]>([]);
  const [expandedContexts, setExpandedContexts] = useState<number[]>([]);
  const toggleContext = (idx: number) =>
    setExpandedContexts((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx],
    );

  const [adsRules, setAdsRules] = useState<AdRuleDto[]>([]);
  const [currentAd, setCurrentAd] = useState<{
    title: string;
    desc: string;
    keyword: string;
  } | null>(null);

  // Tự động cuộn chat
  useEffect(() => {
    activeConvIdRef.current = activeConvId;
  }, [activeConvId]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 1. KHỞI TẠO CHAT & SIGNALR & LẤY LUẬT ADS
  useEffect(() => {
    if (!token) return;

    // Lấy nhóm chat
    axios
      .get(`${API_URL}/api/chat/conversations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        setConversations(res.data);
        if (res.data.length > 0) setActiveConvId(res.data[0].id);
      })
      .catch((err) => console.error("Lỗi lấy danh sách nhóm:", err));

    // Lấy dữ liệu luật Apriori (Nếu Backend chưa có API này thì ta dùng Fallback ở hàm checkAds)
    axios
      .get(`${API_URL}/api/ads/recommendations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((res) => {
        // Trích xuất an toàn dù backend bọc mảng trong items hay data
        const rulesArray = Array.isArray(res.data)
          ? res.data
          : res.data.items || res.data.data || [];
        setAdsRules(rulesArray);
      })
      .catch((err) => console.log("Lỗi lấy Rules:", err));

    // Khởi tạo SignalR
    const newConnection = new HubConnectionBuilder()
      .withUrl(`${API_URL}/ws/chat`, { accessTokenFactory: () => token })
      .configureLogging(LogLevel.Information)
      .withAutomaticReconnect()
      .build();

    newConnection
      .start()
      .then(() => {
        console.log("🟢 SignalR Connected!");
        newConnection.on("ReceiveMessage", (arg1: unknown, arg2?: unknown) => {
          let newMsg: MessageDto | null = null;
          if (typeof arg1 === "string" && typeof arg2 === "string") {
            newMsg = {
              id: Date.now().toString(),
              conversationId: activeConvIdRef.current || "",
              senderId: arg1,
              content: arg2,
            };
          } else if (
            arg1 !== null &&
            typeof arg1 === "object" &&
            "content" in arg1
          ) {
            newMsg = arg1 as MessageDto;
          }

          if (newMsg) {
            if (
              newMsg.conversationId === activeConvIdRef.current ||
              !newMsg.conversationId
            ) {
              setMessages((prev) => [...prev, newMsg!]);
            }
          }
        });
        setConnection(newConnection);
      })
      .catch((e) => console.log("🔴 SignalR Error: ", e));

    return () => {
      newConnection.stop();
    };
  }, [token]);

  // 2. TẢI TIN NHẮN & JOIN PHÒNG CHAT
  useEffect(() => {
    if (!token || !activeConvId) return;

    const fetchMessages = async () => {
      try {
        const res = await axios.get(
          `${API_URL}/api/chat/conversations/${activeConvId}/messages?take=50`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const data = Array.isArray(res.data) ? res.data : res.data.items || [];
        setMessages(data);

        if (connection && connection.state === "Connected") {
          connection
            .invoke("JoinConversation", activeConvId)
            .catch((err) => console.error("Lỗi join phòng:", err));
        }
      } catch (err) {
        console.error("Lỗi lấy tin nhắn:", err);
      }
    };
    fetchMessages();
  }, [activeConvId, token, connection]);

  // --- LOGIC CHỨC NĂNG AI 1: GỢI Ý QUẢNG CÁO (REAL-TIME MATCHING) ---
  const checkAdsMatching = async (text: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/search/match-category`, {
        params: { text: text },
        headers: { Authorization: `Bearer ${token}` },
      });

      console.log("🟢 API Trả về Rule:", res.data);

      const categoryMatch = res.data; // Đây chính là chữ "Dụng cụ thể hình"

      // Nếu Backend trả về một chuỗi hợp lệ (không rỗng)
      if (typeof categoryMatch === "string" && categoryMatch.trim() !== "") {
        // Tự động tạo thẻ quảng cáo dựa trên danh mục tìm được
        setCurrentAd({
          title: `Gợi ý: ${categoryMatch}`,
          desc: `Khám phá ngay các ưu đãi giảm giá tốt nhất cho ${categoryMatch.toLowerCase()} dành riêng cho bạn hôm nay!`,
          keyword: categoryMatch,
        });
      }
    } catch (error) {
      console.error("❌ Lỗi khi tìm Rule:", error);
    }
  };

  // 3. GỬI TIN NHẮN
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !token || !activeConvId) return;

    const textToSend = inputText;
    setInputText("");

    // Kích hoạt Data Mining kiểm tra quảng cáo ngay khi user nhắn
    checkAdsMatching(textToSend);

    try {
      await axios.post(
        `${API_URL}/api/chat/messages/send`,
        { conversationId: activeConvId, content: textToSend },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (error) {
      console.error("Lỗi khi gửi tin nhắn:", error);
    }
  };

  // --- LOGIC CHỨC NĂNG AI 2: TÓM TẮT TIN NHẮN CHƯA ĐỌC ---
  const handleSummarize = async () => {
    if (!activeConvId) return alert("Vui lòng chọn một nhóm chat!");
    setIsSummarizing(true);
    setSummaryResult(null);
    try {
      const res = await axios.get(
        `${API_URL}/api/search/summarize-unread?conversationId=${activeConvId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      // Giả sử API trả về 1 chuỗi string hoặc object
      const resultText =
        typeof res.data === "string"
          ? res.data
          : JSON.stringify(res.data, null, 2);
      setSummaryResult(resultText);
    } catch (error) {
      console.error(error);
      setSummaryResult(
        "⚠️ Không thể tóm tắt. Có thể do chưa có tin nhắn nào hoặc API Gemini báo lỗi.",
      );
    } finally {
      setIsSummarizing(false);
    }
  };

  // --- LOGIC CHỨC NĂNG AI 3: TÌM KIẾM NGỮ NGHĨA (HYBRID SEARCH) ---
  // --- LOGIC CHỨC NĂNG AI 3: TÌM KIẾM NGỮ NGHĨA (HYBRID SEARCH) ---
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConvId || !searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await axios.get(`${API_URL}/api/search/search-context`, {
        params: {
          description: searchQuery,
          conversationId: activeConvId,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      // 1. IN KẾT QUẢ RA CONSOLE ĐỂ KIỂM TRA
      console.log("🟢 DỮ LIỆU BACKEND TRẢ VỀ:", res.data);

      // 2. Bắt mọi trường hợp dữ liệu (Mảng trực tiếp hoặc mảng bọc trong items/data)
      let dataArray = [];
      if (Array.isArray(res.data)) {
        dataArray = res.data;
      } else if (res.data && Array.isArray(res.data.items)) {
        dataArray = res.data.items;
      } else if (res.data && Array.isArray(res.data.data)) {
        dataArray = res.data.data;
      }
      setExpandedContexts([]);
      setSearchResults(dataArray);
    } catch (error) {
      console.error(error);
      alert("Lỗi khi tìm kiếm ngữ nghĩa.");
    } finally {
      setIsSearching(false);
    }
  };
  // --- HÀM CUỘN TỚI TIN NHẮN TỪ KẾT QUẢ TÌM KIẾM ---
  const handleGoToMessage = (messageId: string) => {
    setIsSearchModalOpen(false); // 1. Đóng modal tìm kiếm

    // 2. Chờ 300ms cho modal đóng hẳn rồi mới cuộn để không bị giật lag
    setTimeout(() => {
      const element = document.getElementById(`msg-${messageId}`);
      if (element) {
        // Cuộn tin nhắn đó ra giữa màn hình
        element.scrollIntoView({ behavior: "smooth", block: "center" });

        // 3. Tạo hiệu ứng chớp sáng màu vàng
        const innerMsg = document.getElementById(`msg-inner-${messageId}`);
        if (innerMsg) {
          const originalClasses = innerMsg.className;
          // Phủ màu vàng kim và phóng to nhẹ
          innerMsg.className = `${originalClasses} ring-4 ring-yellow-400 bg-yellow-300 text-gray-900 scale-105`;

          // Trả lại màu gốc sau 2 giây
          setTimeout(() => {
            innerMsg.className = originalClasses;
          }, 2000);
        }
      } else {
        alert(
          "Tin nhắn này nằm ở quá khứ quá xa. Bạn vui lòng cuộn lên trên cùng của khung chat để tải thêm tin nhắn cũ nhé!",
        );
      }
    }, 300);
  };

  // 4. TẠO NHÓM
  const handleCreateChat = async () => {
    const friendId = prompt("Vui lòng nhập User ID của bạn bè:");
    if (!friendId) return;
    try {
      await axios.post(
        `${API_URL}/api/chat/conversations`,
        {
          title: "Phòng Chat Mới",
          isDirect: true,
          members: [friendId],
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      alert("Tạo thành công! Hãy F5 lại.");
      window.location.reload();
    } catch (error) {
      console.error("Lỗi tạo nhóm:", error);
      alert("Tạo thất bại.");
    }
  };

  if (status === "loading")
    return (
      <div className="flex h-screen items-center justify-center">
        Đang tải...
      </div>
    );
  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 flex-col gap-6">
        <h1 className="text-4xl font-bold text-blue-600 mb-2">
          Hệ thống Chat AI
        </h1>
        <button
          onClick={() => signIn("keycloak")}
          className="bg-blue-600 text-white px-8 py-3 rounded-xl shadow-lg hover:bg-blue-700 font-semibold"
        >
          Đăng nhập bằng Keycloak
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 p-2 gap-2 text-sm relative">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border">
        <p className="font-semibold text-gray-700">
          Xin chào, <span className="text-blue-600">{session.user?.name}</span>
        </p>
        <button
          onClick={() => signOut()}
          title="Đăng xuất"
          className="text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg flex items-center gap-2 font-medium"
        >
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>

      <div className="flex flex-1 gap-2 overflow-hidden">
        {/* CỘT 1: Danh sách Chat & Công cụ AI */}
        <div className="w-1/4 bg-white rounded-xl shadow-sm border flex flex-col p-4 overflow-y-auto">
          <h2 className="font-bold text-gray-800 mb-2 border-b pb-2 flex items-center gap-2 text-base">
            <Sparkles size={18} className="text-indigo-600" /> Khám phá AI
          </h2>
          <div className="flex flex-col gap-2 mb-6">
            <button
              onClick={handleSummarize}
              disabled={!activeConvId || isSummarizing}
              className="flex items-center gap-2 w-full bg-indigo-50 border border-indigo-100 text-indigo-700 p-2.5 rounded-lg font-semibold hover:bg-indigo-100 transition text-left disabled:opacity-50"
            >
              {isSummarizing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {isSummarizing ? "Đang tóm tắt..." : "Tóm tắt tin nhắn (Gemini)"}
            </button>
            <button
              onClick={() => setIsSearchModalOpen(true)}
              disabled={!activeConvId}
              className="flex items-center gap-2 w-full bg-teal-50 border border-teal-100 text-teal-700 p-2.5 rounded-lg font-semibold hover:bg-teal-100 transition text-left disabled:opacity-50"
            >
              <Search size={16} /> Tìm kiếm ngữ nghĩa (Hybrid)
            </button>
          </div>

          <div className="mb-4 bg-gray-50 p-3 rounded-lg border border-gray-200">
            <p className="text-[11px] text-gray-500 font-bold mb-1">
              User ID của bạn:
            </p>
            <code className="text-[10px] break-all text-blue-600 font-mono select-all">
              {myUserId}
            </code>
          </div>

          <button
            onClick={handleCreateChat}
            className="flex justify-center items-center gap-2 mb-4 bg-blue-600 text-white p-2.5 rounded-lg font-semibold hover:bg-blue-700 transition"
          >
            <Plus size={18} /> Tạo nhóm Chat
          </button>

          <h2 className="font-bold text-gray-800 mb-2 border-b pb-2">
            Danh sách hội thoại
          </h2>
          <div className="flex flex-col gap-2 flex-1">
            {conversations.length === 0 && (
              <p className="text-xs text-gray-400 italic text-center mt-4">
                Chưa có nhóm nào.
              </p>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveConvId(c.id)}
                className={`p-3 rounded-lg text-left text-sm transition border ${activeConvId === c.id ? "bg-blue-50 border-blue-300 text-blue-800" : "bg-white border-transparent hover:bg-gray-50 text-gray-700"}`}
              >
                <div className="font-semibold flex items-center gap-2">
                  <MessageSquare size={16} /> {c.name || "Chat 1-1"}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* CỘT 2: Khung Chat */}
        <div className="w-2/4 bg-white rounded-xl shadow-sm border flex flex-col relative overflow-hidden">
          <div className="bg-white border-b p-3 font-bold text-gray-800 flex justify-center items-center shadow-sm z-10">
            {conversations.find((c) => c.id === activeConvId)?.name ||
              "Chưa chọn phòng chat"}
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-50/50">
            {!activeConvId && (
              <div className="text-center text-gray-400 mt-10">
                Vui lòng chọn hoặc tạo một cuộc trò chuyện.
              </div>
            )}
            {messages.map((msg, idx) => {
              const isMe = msg.senderId === myUserId;
              return (
                <div
                  key={idx}
                  id={`msg-${msg.id}`}
                  className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  <div
                    id={`msg-inner-${msg.id}`}
                    className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-[15px] transition-all duration-700 ${isMe ? "bg-blue-600 text-white rounded-br-sm shadow-sm" : "bg-white border text-gray-800 rounded-bl-sm shadow-sm"}`}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={handleSendMessage}
            className="p-3 bg-white border-t flex gap-2 items-center"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Nhập tin nhắn để AI phân tích..."
              disabled={!activeConvId}
              className="flex-1 border p-2.5 rounded-full px-5 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
            />
            <button
              title="b"
              type="submit"
              disabled={!activeConvId}
              className="bg-blue-600 text-white p-2.5 w-11 h-11 flex items-center justify-center rounded-full hover:bg-blue-700 disabled:bg-gray-400"
            >
              <Send size={18} />
            </button>
          </form>
        </div>

        {/* CỘT 3: Ads (Apriori Data Mining) */}
        <div className="w-1/4 bg-amber-50/50 rounded-xl shadow-sm border border-amber-200 flex flex-col p-4">
          <h2 className="font-bold text-amber-800 mb-4 flex items-center gap-2">
            <ShoppingCart size={20} /> Gợi ý cho bạn
          </h2>

          {currentAd ? (
            <div className="bg-white border border-amber-300 rounded-xl p-4 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-amber-500 text-white text-[10px] px-2 py-1 rounded-bl-lg font-bold flex items-center gap-1">
                <Zap size={10} /> TÀI TRỢ
              </div>
              <p className="text-xs text-amber-600 font-bold mb-1">
                Bởi vì bạn nhắc đến &quot;{currentAd.keyword}&quot;:
              </p>
              <h3 className="font-bold text-gray-800 text-base mb-2 mt-2">
                {currentAd.title}
              </h3>
              <p className="text-gray-600 text-sm mb-4">{currentAd.desc}</p>
              <button className="w-full bg-amber-500 text-white py-2 rounded-lg font-semibold hover:bg-amber-600 transition">
                Xem chi tiết
              </button>
            </div>
          ) : (
            <div className="flex-1 border-2 border-dashed border-amber-300 rounded-xl flex items-center justify-center text-amber-600/70 p-6 bg-white/50 text-center flex-col gap-2">
              <Sparkles size={32} className="opacity-50" />
              <p className="font-medium">
                Hệ thống AI Apriori đang lắng nghe tin nhắn của bạn để đưa ra
                gợi ý...
              </p>
              <p className="text-xs">
                Thử chat từ khóa:&quot;Điện thoại&quot;, &quot;Laptop&quot;,
                &quot;Du lịch&quot;
              </p>
            </div>
          )}
        </div>
      </div>

      {/* --- MODAL HIỂN THỊ TÓM TẮT --- */}
      {summaryResult && (
        <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[500px] max-w-full flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-indigo-600 p-4 text-white flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2">
                <Sparkles size={18} /> AI Tóm Tắt Tin Nhắn
              </h3>
              <button
                title="a"
                onClick={() => setSummaryResult(null)}
                className="hover:bg-white/20 p-1 rounded-full transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              <pre className="whitespace-pre-wrap font-sans text-gray-700 leading-relaxed">
                {summaryResult}
              </pre>
            </div>
            <div className="p-4 border-t bg-gray-50 flex justify-end">
              <button
                onClick={() => setSummaryResult(null)}
                className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL HIỂN THỊ TÌM KIẾM HYBRID --- */}
      {isSearchModalOpen && (
        <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm z-50 flex flex-col items-center pt-20 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-[600px] max-w-full flex flex-col overflow-hidden animate-in slide-in-from-top-4 duration-200">
            <div className="p-2 flex justify-end">
              <button
                title="c"
                onClick={() => setIsSearchModalOpen(false)}
                className="text-gray-400 hover:text-gray-800 p-1"
              >
                <X size={20} />
              </button>
            </div>
            <div className="px-6 pb-6">
              <h3 className="font-bold text-xl mb-4 text-teal-800 flex items-center gap-2">
                <Search size={22} /> Semantic Hybrid Search
              </h3>
              <form onSubmit={handleSearch} className="flex gap-2 mb-6">
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nhập câu hỏi hoặc ngữ cảnh cần tìm..."
                  className="flex-1 border-2 border-teal-100 p-3 rounded-xl focus:outline-none focus:border-teal-500 bg-teal-50/30"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="bg-teal-600 text-white px-6 rounded-xl font-bold hover:bg-teal-700 disabled:opacity-70"
                >
                  {isSearching ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    "Tìm kiếm"
                  )}
                </button>
              </form>

              <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
                {searchResults.length === 0 && !isSearching && (
                  <p className="text-center text-gray-400 py-4">
                    Nhập từ khóa để AI quét Vector & BM25...
                  </p>
                )}
                {searchResults.map((res, idx) => (
                  <div
                    key={idx}
                    className="bg-gray-50 p-4 rounded-xl border border-gray-200 flex flex-col gap-1"
                  >
                    {/* Hiển thị nội dung tin nhắn tìm được */}
                    <p className="text-gray-800 text-base font-medium">
                      {res.anchorMessage?.content}
                    </p>

                    {/* Nút bấm và hộp hiển thị ngữ cảnh */}
                    {res.surroundingMessages &&
                      res.surroundingMessages.length > 0 && (
                        <div className="mt-1">
                          <button
                            onClick={() => toggleContext(idx)}
                            className="text-xs text-teal-700 font-semibold hover:text-teal-900 transition underline-offset-2 hover:underline flex items-center gap-1"
                            type="button"
                          >
                            {expandedContexts.includes(idx)
                              ? "Thu gọn ngữ cảnh ▴"
                              : `+ Xem ${res.surroundingMessages.length} tin nhắn xung quanh ▾`}
                          </button>

                          {/* Khung cuộn hiển thị các tin nhắn khi bấm mở rộng */}
                          {expandedContexts.includes(idx) && (
                            <div className="mt-2 flex flex-col gap-1.5 p-3 bg-white border border-teal-100 rounded-lg shadow-inner max-h-[250px] overflow-y-auto">
                              {res.surroundingMessages.map((ctxMsg, ctxIdx) => {
                                // Highlight câu kết quả chính để dễ phân biệt với ngữ cảnh
                                const isAnchor =
                                  ctxMsg.id === res.anchorMessage?.id;
                                return (
                                  <div
                                    key={ctxIdx}
                                    className={`p-2 rounded text-sm ${isAnchor ? "bg-teal-50 border border-teal-200" : "bg-gray-50 border border-gray-100"}`}
                                  >
                                    {isAnchor && (
                                      <span className="text-[10px] font-bold text-teal-600 mb-1 block">
                                        📌 Kết quả chính:
                                      </span>
                                    )}
                                    <p className="text-gray-700">
                                      {ctxMsg.content}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                    <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-100">
                      <div className="flex gap-2 items-center">
                        <span className="text-[10px] text-gray-400">
                          Match Score: {res.relevanceScore?.toFixed(4) || "N/A"}
                        </span>
                        <span className="text-[10px] bg-teal-100 text-teal-800 px-2 py-0.5 rounded-full font-semibold">
                          ID: {res.anchorMessage?.id?.substring(0, 8)}
                        </span>
                      </div>

                      {/* NÚT CHUYỂN HƯỚNG TỚI TIN NHẮN */}
                      <button
                        onClick={() =>
                          res.anchorMessage?.id &&
                          handleGoToMessage(res.anchorMessage.id)
                        }
                        type="button"
                        className="text-[11px] bg-indigo-600 text-white px-3 py-1.5 rounded-full font-bold hover:bg-indigo-700 transition shadow-sm flex items-center gap-1"
                      >
                        Đi tới tin nhắn ➔
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

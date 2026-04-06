import NextAuth, { DefaultSession } from "next-auth";
import KeycloakProvider from "next-auth/providers/keycloak";

// 1. Định nghĩa thêm accessToken cho Session
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    user: {
      id?: string;
    } & DefaultSession["user"];
  }
}

// 2. Định nghĩa thêm accessToken cho JWT
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
  }
}

// 3. Khởi tạo NextAuth
const handler = NextAuth({
  providers: [
    KeycloakProvider({
      clientId: process.env.KEYCLOAK_CLIENT_ID!,
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET || "",
      issuer: process.env.KEYCLOAK_ISSUER!,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      // Khi user đăng nhập thành công, account sẽ có dữ liệu
      if (account) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      // Gán token vào session một cách an toàn (không bị lỗi TypeScript nữa)
      session.accessToken = token.accessToken;
      return session;
    },
  },
});

export { handler as GET, handler as POST };

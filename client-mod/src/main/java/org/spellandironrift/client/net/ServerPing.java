package org.spellandironrift.client.net;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import net.minecraft.Util;
import org.spellandironrift.client.RiftClientMod;
import org.spellandironrift.client.config.RiftConfig;

/**
 * Server List Ping (the same request the vanilla server list makes): online/max players, the server's message
 * and the round trip time. Runs off the render thread; the menu reads the latest {@link #result()}.
 * Re-checks every 30 s while online and every 10 s while the server does not answer.
 */
public final class ServerPing {
    public enum State { CHECKING, ONLINE, OFFLINE }

    public record Result(State state, int online, int max, String motd, long pingMs, long at) {
        static Result checking() { return new Result(State.CHECKING, 0, 0, "", -1, System.currentTimeMillis()); }
    }

    private static final int PROTOCOL_1_21_1 = 767;
    private static volatile Result result = Result.checking();
    private static volatile boolean running;
    private static volatile long nextCheck;

    private ServerPing() {}

    public static Result result() { return result; }

    /** Seconds until the next automatic check (shown while the server is offline). */
    public static int secondsToNextCheck() {
        return (int) Math.max(0, Math.ceil((nextCheck - System.currentTimeMillis()) / 1000.0));
    }

    /** Called every frame by the menu: starts a check when one is due. */
    public static void tick() {
        if (!running && System.currentTimeMillis() >= nextCheck) checkNow();
    }

    public static void checkNow() {
        if (running) return;
        running = true;
        if (result.state() == State.OFFLINE) result = Result.checking();
        RiftConfig.Values cfg = RiftConfig.get();
        CompletableFuture.supplyAsync(() -> ping(cfg.serverHost(), cfg.serverPort()), Util.backgroundExecutor())
                .whenComplete((r, e) -> {
                    result = r != null ? r : new Result(State.OFFLINE, 0, 0, "", -1, System.currentTimeMillis());
                    nextCheck = System.currentTimeMillis() + (result.state() == State.ONLINE ? 30_000 : 10_000);
                    running = false;
                });
    }

    private static Result ping(String host, int port) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), 4000);
            socket.setSoTimeout(4000);
            DataOutputStream out = new DataOutputStream(socket.getOutputStream());
            DataInputStream in = new DataInputStream(socket.getInputStream());

            // handshake (next state 1 = status), then status request
            ByteArrayOutputStream hs = new ByteArrayOutputStream();
            DataOutputStream h = new DataOutputStream(hs);
            writeVarInt(h, 0x00);
            writeVarInt(h, PROTOCOL_1_21_1);
            byte[] hostBytes = host.getBytes(StandardCharsets.UTF_8);
            writeVarInt(h, hostBytes.length);
            h.write(hostBytes);
            h.writeShort(port);
            writeVarInt(h, 1);
            writeVarInt(out, hs.size());
            out.write(hs.toByteArray());
            writeVarInt(out, 1);
            writeVarInt(out, 0x00);
            out.flush();

            readVarInt(in); // packet length
            if (readVarInt(in) != 0x00) throw new IOException("unexpected status packet");
            int len = readVarInt(in);
            if (len <= 0 || len > 1 << 20) throw new IOException("bad status length");
            byte[] json = new byte[len];
            in.readFully(json);

            // ping/pong for the round trip time
            long sent = System.nanoTime();
            writeVarInt(out, 9);
            writeVarInt(out, 0x01);
            out.writeLong(System.currentTimeMillis());
            out.flush();
            long pingMs;
            try {
                readVarInt(in);
                readVarInt(in);
                in.readLong();
                pingMs = Math.max(1, (System.nanoTime() - sent) / 1_000_000);
            } catch (IOException e) {
                pingMs = -1; // some proxies close after the status; the server is still online
            }

            JsonObject o = JsonParser.parseString(new String(json, StandardCharsets.UTF_8)).getAsJsonObject();
            int online = 0, max = 0;
            if (o.has("players")) {
                JsonObject p = o.getAsJsonObject("players");
                online = p.has("online") ? p.get("online").getAsInt() : 0;
                max = p.has("max") ? p.get("max").getAsInt() : 0;
            }
            String motd = o.has("description") ? plain(o.get("description")).replaceAll("§.", "").trim() : "";
            return new Result(State.ONLINE, online, max, motd, pingMs, System.currentTimeMillis());
        } catch (Exception e) {
            RiftClientMod.LOG.debug("Server ping failed: {}", e.toString());
            return new Result(State.OFFLINE, 0, 0, "", -1, System.currentTimeMillis());
        }
    }

    /** Plain text of a chat component in JSON form (string, {"text", "extra"} or an array). */
    private static String plain(JsonElement e) {
        if (e == null || e.isJsonNull()) return "";
        if (e.isJsonPrimitive()) return e.getAsString();
        StringBuilder sb = new StringBuilder();
        if (e.isJsonArray()) {
            for (JsonElement c : e.getAsJsonArray()) sb.append(plain(c));
            return sb.toString();
        }
        JsonObject o = e.getAsJsonObject();
        if (o.has("text")) sb.append(o.get("text").getAsString());
        if (o.has("extra")) sb.append(plain(o.get("extra")));
        return sb.toString();
    }

    private static void writeVarInt(DataOutputStream out, int value) throws IOException {
        while ((value & ~0x7F) != 0) {
            out.writeByte((value & 0x7F) | 0x80);
            value >>>= 7;
        }
        out.writeByte(value);
    }

    private static int readVarInt(DataInputStream in) throws IOException {
        int value = 0, shift = 0;
        while (true) {
            byte b = in.readByte();
            value |= (b & 0x7F) << shift;
            if ((b & 0x80) == 0) return value;
            shift += 7;
            if (shift > 35) throw new IOException("VarInt too big");
        }
    }
}

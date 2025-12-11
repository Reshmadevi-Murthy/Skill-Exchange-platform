import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";

dotenv.config();
const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.ORIGIN || "http://localhost:5173";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

// ensure upload folder exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// middlewares
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

// 🔒 auth middleware (supports Bearer token in header OR ?token= in query)
const auth = (req, res, next) => {
  const token =
    req.headers.authorization?.split(" ")[1] || req.query.token || null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) =>
    cb(
      null,
      Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        path.extname(file.originalname)
    ),
});
const upload = multer({ storage });

/* ======================
   AUTH ROUTES
====================== */

// Register
app.post("/register", async (req, res) => {
  try {
    const { name, email, password, mobile, age, profession } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "name, email and password are required" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hashed,
        mobile: mobile || "",
        age: Number(age || 0),
        profession: profession || "",
      },
    });

    return res
      .status(201)
      .json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(400).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
  });
});

// Get current user info
app.get("/me", auth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true, profession: true }
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

/* ======================
   SKILLS & WANTS
====================== */

// Upload skill video
app.post("/skills", auth, upload.single("video"), async (req, res) => {
  try {
    const { title, description } = req.body;
    if (!req.file) return res.status(400).json({ error: "Video required" });

    const skill = await prisma.skill.create({
      data: {
        title,
        description,
        videoPath: req.file.filename,
        ownerId: req.user.id,
      },
    });
    res.json(skill);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// List all skills
app.get("/skills", async (_req, res) => {
  const skills = await prisma.skill.findMany({
    include: { owner: { select: { id: true, name: true, email: true, profession: true } } },
    orderBy: { createdAt: "desc" },
  });
  // Map the response to match frontend expectations
  const mappedSkills = skills.map(skill => ({
    ...skill,
    userId: skill.ownerId,
    user: skill.owner
  }));
  res.json(mappedSkills);
});

// Post wants
app.post("/wants", auth, async (req, res) => {
  const { title, description } = req.body;
  const want = await prisma.want.create({
    data: { title, description, ownerId: req.user.id },
  });
  res.json(want);
});

// My wants
app.get("/wants/me", auth, async (req, res) => {
  const wants = await prisma.want.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json(wants);
});

// Matches
app.get("/matches", auth, async (req, res) => {
  const myWants = await prisma.want.findMany({
    where: { ownerId: req.user.id },
  });
  if (myWants.length === 0) return res.json([]);

  const orClauses = myWants.map((w) => ({
    title: { contains: w.title, mode: "insensitive" },
  }));

  const skills = await prisma.skill.findMany({
    where: { ownerId: { not: req.user.id }, OR: orClauses },
    include: { owner: { select: { id: true, name: true, email: true, profession: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Map the response to match frontend expectations
  const mappedSkills = skills.map(skill => ({
    ...skill,
    userId: skill.ownerId,
    user: skill.owner
  }));
  res.json(mappedSkills);
});

/* ======================
   REQUESTS
====================== */

// Create request
app.post("/requests/:videoId", auth, async (req, res) => {
  const videoId = Number(req.params.videoId);
  const video = await prisma.skill.findUnique({ where: { id: videoId } });
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (video.ownerId === req.user.id)
    return res.status(400).json({ error: "Cannot request your own video" });

  const existing = await prisma.request.findFirst({
    where: {
      fromId: req.user.id,
      skillId: videoId,
      status: "pending",
    },
  });
  if (existing) return res.status(400).json({ error: "Request already pending" });

  const reqRow = await prisma.request.create({
    data: { fromId: req.user.id, toId: video.ownerId, skillId: videoId },
  });
  res.json(reqRow);
});

// Get requests
app.get("/requests", auth, async (req, res) => {
  const { type } = req.query; // incoming | outgoing
  const where =
    type === "outgoing" ? { fromId: req.user.id } : { toId: req.user.id };

  const rows = await prisma.request.findMany({
    where,
    include: {
      from: { select: { id: true, name: true, email: true } },
      to: { select: { id: true, name: true, email: true } },
      skill: true,
    },
    orderBy: { createdAt: "desc" },
  });
  
  // Map the response to match frontend expectations
  const mappedRequests = rows.map(request => ({
    ...request,
    fromUser: request.from,
    toUser: request.to
  }));
  
  res.json(mappedRequests);
});

// Accept request
app.post("/requests/:id/accept", auth, async (req, res) => {
  const id = Number(req.params.id);
  const r = await prisma.request.findUnique({ where: { id } });
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.toId !== req.user.id)
    return res.status(403).json({ error: "Not your request" });

  const updated = await prisma.request.update({
    where: { id },
    data: { status: "accepted" },
  });

  await prisma.permission.upsert({
    where: { userId_videoId: { userId: r.fromId, videoId: r.skillId } },
    update: {},
    create: { userId: r.fromId, videoId: r.skillId },
  });

  res.json(updated);
});

// Decline request
app.post("/requests/:id/decline", auth, async (req, res) => {
  const id = Number(req.params.id);
  const r = await prisma.request.findUnique({ where: { id } });
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.toId !== req.user.id)
    return res.status(403).json({ error: "Not your request" });

  const updated = await prisma.request.update({
    where: { id },
    data: { status: "declined" },
  });
  res.json(updated);
});

/* ======================
   PERMISSIONS / STREAM
====================== */

// Authorized videos
app.get("/authorized", auth, async (req, res) => {
  const perms = await prisma.permission.findMany({
    where: { userId: req.user.id },
    include: {
      video: { include: { owner: { select: { id: true, name: true } } } },
    },
    orderBy: { id: "desc" },
  });
  res.json(perms.map((p) => p.video));
});

// Stream
app.get("/stream/:videoId", auth, async (req, res) => {
  const videoId = Number(req.params.videoId);
  const video = await prisma.skill.findUnique({ where: { id: videoId } });
  if (!video) return res.status(404).json({ error: "Video not found" });

  if (video.ownerId !== req.user.id) {
    const hasPerm = await prisma.permission.findUnique({
      where: { userId_videoId: { userId: req.user.id, videoId } },
    });
    if (!hasPerm) return res.status(403).json({ error: "No permission" });
  }

  const abs = path.resolve(UPLOAD_DIR, video.videoPath);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "File missing" });

  res.sendFile(abs);
});

/* ======================
   ROOT
====================== */

app.get("/", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});

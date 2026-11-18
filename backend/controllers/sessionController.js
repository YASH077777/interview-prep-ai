const Session = require("../models/Session");
const Question = require("../models/Question");
const mongoose = require("mongoose");

const createSession = async (req, res) => {
  try {
    const { role, experience, description, difficulty } = req.body;
    if (!role || !experience) {
      return res.status(400).json({ message: "Role and experience are required" });
    }

    const expNum = Number(experience);
    if (!isNaN(expNum) && expNum < 0) {
      return res.status(400).json({ message: "Experience cannot be negative" });
    }

    const session = await Session.create({
      userId: req.user.id,
      role,
      experience,
      description: description || "",
      difficulty: difficulty || "Medium",
    });

    const sObj = session.toJSON();
    sObj.id = session._id.toString();
    res.status(201).json(sObj);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const getAllSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.id }).sort({ createdAt: -1 });
    
    // Fetch questions for each session
    const sessionsWithQuestions = await Promise.all(
      sessions.map(async (s) => {
        const questions = await Question.find({ sessionId: s._id });
        const sObj = s.toJSON();
        sObj.id = s._id.toString();
        sObj.questions = questions.map((q) => {
          const qObj = q.toJSON();
          qObj.id = q._id.toString();
          return qObj;
        });
        return sObj;
      })
    );
    
    res.json(sessionsWithQuestions);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const getSessionById = async (req, res) => {
  try {
    const sessionId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(404).json({ message: "Session not found" });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    const questions = await Question.find({ sessionId: session._id });
    const sObj = session.toJSON();
    sObj.id = session._id.toString();
    sObj.questions = questions.map((q) => {
      const qObj = q.toJSON();
      qObj.id = q._id.toString();
      return qObj;
    });
    
    res.json(sObj);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const deleteSession = async (req, res) => {
  try {
    const sessionId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(404).json({ message: "Session not found" });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    await Question.deleteMany({ sessionId: session._id });
    await Session.findByIdAndDelete(session._id);
    
    res.json({ message: "Session deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { createSession, getAllSessions, getSessionById, deleteSession };
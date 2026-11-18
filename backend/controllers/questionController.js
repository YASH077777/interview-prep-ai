const Question = require("../models/Question");
const Session = require("../models/Session");
const mongoose = require("mongoose");

const addQuestion = async (req, res) => {
  try {
    const { sessionId, question, answer } = req.body;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(404).json({ message: "Session not found" });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    
    if (!session) return res.status(404).json({ message: "Session not found" });
    
    const newQuestion = await Question.create({
      sessionId,
      question,
      answer: answer || "",
    });

    const qObj = newQuestion.toJSON();
    qObj.id = newQuestion._id.toString();
    
    res.status(201).json(qObj);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const togglePin = async (req, res) => {
  try {
    const { questionId } = req.body;
    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(404).json({ message: "Question not found" });
    }

    const question = await Question.findById(questionId);
    if (!question) return res.status(404).json({ message: "Question not found" });
    
    const session = await Session.findById(question.sessionId);
    if (session.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    question.isPinned = !question.isPinned;
    await question.save();

    const qObj = question.toJSON();
    qObj.id = question._id.toString();
    res.json(qObj);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

const toggleRead = async (req, res) => {
  try {
    const { questionId } = req.body;
    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(404).json({ message: "Question not found" });
    }

    const question = await Question.findById(questionId);
    if (!question) return res.status(404).json({ message: "Question not found" });
    
    const session = await Session.findById(question.sessionId);
    if (session.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }
    
    question.isRead = !question.isRead;
    await question.save();

    const qObj = question.toJSON();
    qObj.id = question._id.toString();
    res.json(qObj);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = { addQuestion, togglePin, toggleRead };
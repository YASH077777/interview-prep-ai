const Question = require("../models/Question");
const Session = require("../models/Session");
const mongoose = require("mongoose");

// Gemini first, Groq as automatic backup (see utils/aiClient.js)
const groq = require("../utils/aiClient");

const generateQuestions = async (req, res) => {
  try {
    const { role, experience, sessionId, numberOfQuestions = 5 } = req.body;
    if (!role || !experience || !sessionId) {
      return res.status(400).json({ message: "role, experience, sessionId are required" });
    }
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

    // Fetch existing questions for this session to guarantee unique/different questions
    const existingQuestions = await Question.find({ sessionId }).select("question");
    const existingTitles = existingQuestions.map((q) => q.question);

    let excludeInstructions = "";
    if (existingTitles.length > 0) {
      excludeInstructions = `\nCRITICAL UNIQUENESS REQUIREMENT:
The following questions have ALREADY been asked in this session. You MUST NOT repeat, paraphrase, or ask anything similar to these:
- ${existingTitles.slice(-15).join("\n- ")}

Generate COMPLETELY NEW, DIFFERENT, FRESH AND UNIQUE questions that cover different topics/aspects of ${role}.`;
    }

    const difficulty = session.difficulty || "Medium";
    const expYears = Number(experience) || 0;

    let difficultyDetail = "";
    if (difficulty.toLowerCase() === "easy") {
      difficultyDetail = "EASY LEVEL: Focus strictly on basic concepts, syntax, fundamental definitions, and core principles. Questions MUST be simple, clear, and easy to answer for a beginner. Avoid complex scenarios or deep architecture.";
    } else if (difficulty.toLowerCase() === "hard") {
      difficultyDetail = "HARD LEVEL: Focus strictly on complex internal mechanisms, advanced system architecture, low-level optimization, memory management, tricky edge cases, and high-concurrency scenarios. Questions MUST be highly challenging.";
    } else {
      difficultyDetail = "MEDIUM LEVEL: Focus on practical application, real-world code implementation, API design, common design patterns, and standard debugging scenarios.";
    }

    let expDetail = "";
    if (expYears <= 1) {
      expDetail = `FOR ${expYears} YEARS EXPERIENCE (Entry Level / Junior): Tailor questions specifically for beginner developers. Focus on foundational understanding and basic coding logic.`;
    } else if (expYears <= 4) {
      expDetail = `FOR ${expYears} YEARS EXPERIENCE (Mid Level): Tailor questions specifically for mid-level developers. Focus on hands-on project experience, framework features, database queries, and clean code practices.`;
    } else {
      expDetail = `FOR ${expYears} YEARS EXPERIENCE (Senior / Lead): Tailor questions specifically for senior engineers. Focus on high-level system architecture, microservices, scalability, security trade-offs, and tech lead decision-making.`;
    }

    const prompt = `You are an expert technical interviewer. Generate exactly ${numberOfQuestions} technical interview questions for a candidate applying for a ${role} position.

STRICT DIFFICULTY LEVEL: ${difficulty.toUpperCase()}
Guidance: ${difficultyDetail}

STRICT EXPERIENCE LEVEL: ${experience} YEARS
Guidance: ${expDetail}
${excludeInstructions}

CRITICAL RULES:
1. Make sure questions match the EXACT difficulty (${difficulty}) and experience level (${experience} years).
2. For Easy difficulty or 0-1 years exp, questions MUST be straightforward and accessible.
3. For Hard difficulty or 5+ years exp, questions MUST be challenging and deep.
4. Ensure every single question generated is FRESH, UNPRECEDENTED and DIFFERENT from previous questions.
5. Return ONLY a valid JSON array with no markdown formatting.
Format:
[
  {
    "question": "Clear question text matching difficulty and experience",
    "answer": "Accurate and clear answer text"
  }
]`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "openai/gpt-oss-120b",
      temperature: 0.85,
    });

    const text = completion.choices[0].message.content;
    const cleanedText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/g, "").trim();
    let questionsData;
    try {
      questionsData = JSON.parse(cleanedText);
    } catch {
      return res.status(500).json({ message: "AI returned an invalid response. Please try again." });
    }

    const savedQuestions = await Promise.all(
      questionsData.map(async (q) => {
        const question = await Question.create({
          sessionId,
          question: q.question,
          answer: q.answer,
        });
        const qObj = question.toJSON();
        qObj.id = question._id.toString();
        return qObj;
      })
    );
    
    res.status(201).json({ message: savedQuestions.length + " questions generated", questions: savedQuestions });
  } catch (error) {
    console.log("EXACT ERROR:", error.message);
    res.status(500).json({ message: "AI generation failed", error: error.message });
  }
};

const explainQuestion = async (req, res) => {
  try {
    const { questionId } = req.body;
    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      return res.status(404).json({ message: "Question not found" });
    }

    const question = await Question.findById(questionId);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }
    
    const session = await Session.findById(question.sessionId);
    if (session.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const prompt = `Explain this interview question in detail. Question: ${question.question} Answer: ${question.answer} Cover why it is asked, key concepts, and tips to answer confidently.`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "openai/gpt-oss-120b",
    });

    const explanation = completion.choices[0].message.content;
    question.explanation = explanation;
    await question.save();

    const qObj = question.toJSON();
    qObj.id = question._id.toString();
    res.json({ explanation, question: qObj });
  } catch (error) {
    console.log("EXACT ERROR:", error.message);
    res.status(500).json({ message: "AI explanation failed", error: error.message });
  }
};

const generateQuiz = async (req, res) => {
  try {
    const { sessionId, numberOfQuestions } = req.body;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const questions = await Question.find({ sessionId });
    if (!questions || questions.length === 0) {
      return res.status(400).json({ message: "No questions in this session" });
    }

    // Always shuffle questions so quiz order is randomized
    let selectedQuestions = [...questions].sort(() => 0.5 - Math.random());
    if (numberOfQuestions && numberOfQuestions < selectedQuestions.length) {
      selectedQuestions = selectedQuestions.slice(0, numberOfQuestions);
    }

    const questionsForQuiz = selectedQuestions.map((q) => ({
      questionId: q._id.toString(),
      question: q.question,
      correctAnswer: q.answer,
    }));

    const prompt = `You are a quiz generator for technical interviews. For each question below, generate 4 multiple-choice options where exactly 1 is correct. The correct option must be based on the provided correct answer. The 3 wrong options should be plausible but clearly incorrect to someone who knows the topic.

IMPORTANT RULES:
- Return ONLY a valid JSON array with no markdown
- Each item must have: questionId, options (array of 4 strings), correctIndex (0-3 indicating which option is correct)
- Shuffle the correct answer position randomly (don't always put it first)
- Make options concise (1-2 sentences max each)
- Wrong options should be believable but wrong

Questions:
${JSON.stringify(questionsForQuiz, null, 2)}

Return format: [{"questionId": "id", "options": ["option A", "option B", "option C", "option D"], "correctIndex": 2}]`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "openai/gpt-oss-120b",
    });

    const text = completion.choices[0].message.content;
    const cleanedText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/g, "").trim();
    let quizData;
    try {
      quizData = JSON.parse(cleanedText);
    } catch {
      return res.status(500).json({ message: "AI returned an invalid quiz response. Please try again." });
    }

    const enrichedQuiz = quizData.map((q) => {
      const original = questionsForQuiz.find((oq) => oq.questionId === q.questionId);
      return {
        questionId: q.questionId,
        question: original?.question || "",
        options: q.options,
        correctIndex: q.correctIndex,
      };
    });

    res.json({ quiz: enrichedQuiz, totalQuestions: enrichedQuiz.length });
  } catch (error) {
    console.log("EXACT ERROR:", error.message);
    res.status(500).json({ message: "Quiz generation failed", error: error.message });
  }
};

const evaluateQuiz = async (req, res) => {
  try {
    const { sessionId, quizAnswers } = req.body;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId) || !quizAnswers || !Array.isArray(quizAnswers)) {
      return res.status(400).json({ message: "sessionId and quizAnswers array are required" });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const questions = await Question.find({ sessionId });

    let correctCount = 0;
    const results = quizAnswers.map((qa) => {
      const q = questions.find((qq) => qq._id.toString() === qa.questionId);
      const isCorrect = qa.selectedIndex === qa.correctIndex;
      if (isCorrect) correctCount++;
      return {
        questionId: qa.questionId,
        question: q?.question || "",
        correctAnswer: q?.answer || "",
        selectedIndex: qa.selectedIndex,
        correctIndex: qa.correctIndex,
        selectedOption: qa.selectedOption || "",
        correctOption: qa.correctOption || "",
        isCorrect,
      };
    });

    const totalQuestions = results.length;
    const percentage = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

    res.json({
      correctCount,
      totalQuestions,
      percentage,
      results,
    });
  } catch (error) {
    console.log("EXACT ERROR:", error.message);
    res.status(500).json({ message: "Quiz evaluation failed", error: error.message });
  }
};

const evaluateTest = async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId) || !answers || !Array.isArray(answers)) {
      return res.status(400).json({ message: "sessionId and answers array are required" });
    }

    const session = await Session.findOne({
      _id: sessionId,
      userId: req.user.id,
    });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const questions = await Question.find({ sessionId });
    const questionsForEval = answers.map((a) => {
      const q = questions.find((qq) => qq._id.toString() === a.questionId);
      return {
        questionId: a.questionId,
        question: q?.question || "",
        correctAnswer: q?.answer || "",
        userAnswer: a.userAnswer || "(no answer provided)",
      };
    });

    const prompt = `You are an interview answer evaluator. Evaluate each user answer by comparing it to the correct answer. For each question, provide a score from 0 to 10 and brief feedback (1-2 sentences). Be fair - partial answers deserve partial credit. Return ONLY a valid JSON array with no markdown: [{"questionId": "id", "score": 8, "feedback": "Good explanation but missed X concept"}]

Questions to evaluate:
${JSON.stringify(questionsForEval, null, 2)}`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "openai/gpt-oss-120b",
    });

    const text = completion.choices[0].message.content;
    const cleanedText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/g, "").trim();
    let results;
    try {
      results = JSON.parse(cleanedText);
    } catch {
      return res.status(500).json({ message: "AI returned an invalid evaluation. Please try again." });
    }

    const totalScore = results.reduce((sum, r) => sum + (r.score || 0), 0);
    const maxScore = results.length * 10;
    const percentage = Math.round((totalScore / maxScore) * 100);

    const enrichedResults = results.map((r) => {
      const original = questionsForEval.find((q) => q.questionId === r.questionId);
      return {
        ...r,
        question: original?.question || "",
        correctAnswer: original?.correctAnswer || "",
        userAnswer: questionsForEval.find((q) => q.questionId === r.questionId)?.userAnswer || "",
      };
    });

    res.json({
      totalScore,
      maxScore,
      percentage,
      totalQuestions: results.length,
      results: enrichedResults,
    });
  } catch (error) {
    console.log("EXACT ERROR:", error.message);
    res.status(500).json({ message: "AI evaluation failed", error: error.message });
  }
};

async function generateFromResume(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Please upload a PDF file" });
    }

    // pdf-parse v2 exports a PDFParse class (the old `pdfParse(buffer)` function no longer exists)
    const { PDFParse } = require("pdf-parse");
    const fs = require("fs");

    const dataBuffer = fs.readFileSync(req.file.path);
    const parser = new PDFParse({ data: dataBuffer });
    let resumeText = "";
    try {
      const pdfData = await parser.getText();
      resumeText = pdfData.text;
    } finally {
      await parser.destroy().catch(() => {});
    }

    fs.unlinkSync(req.file.path);

    if (!resumeText || resumeText.trim().length < 50) {
      return res.status(400).json({ message: "Could not extract enough text from the resume. Please upload a valid PDF." });
    }

    const { role, numberOfQuestions = 10, difficulty = "Medium" } = req.body;
    const targetRole = role || "Software Developer";

    const extractPrompt = `Analyze this resume and extract: the candidate's name, top skills, experience level (years), and key technologies. Return ONLY valid JSON with no markdown:
{"name": "...", "skills": ["skill1", "skill2"], "experience": "X years", "technologies": ["tech1", "tech2"], "summary": "brief 1-line summary"}

Resume text:
${resumeText.substring(0, 3000)}`;

    const extractCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: extractPrompt }],
      model: "openai/gpt-oss-120b",
    });

    let profileData;
    try {
      const extractText = extractCompletion.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/g, "").trim();
      profileData = JSON.parse(extractText);
    } catch {
      profileData = { name: "Candidate", skills: [], experience: "Unknown", technologies: [], summary: "Resume analyzed" };
    }

    const expNum = parseInt(profileData.experience) || 0;
    let expGuidance = "";
    if (expNum <= 1) {
      expGuidance = "Entry level (0-1 years): Focus on fundamentals, core syntax, and basic concepts.";
    } else if (expNum <= 4) {
      expGuidance = "Mid level (2-4 years): Focus on practical project execution, frameworks, APIs, and debugging.";
    } else {
      expGuidance = "Senior level (5+ years): Focus on architecture, performance optimization, design patterns, and scalability.";
    }

    const questionPrompt = `Based on this candidate's resume, generate ${numberOfQuestions} targeted ${difficulty}-level interview questions for a ${targetRole} position.

Candidate Profile:
- Skills: ${(profileData.skills || []).join(", ")}
- Technologies: ${(profileData.technologies || []).join(", ")}
- Experience: ${profileData.experience || "Not specified"} (${expGuidance})

STRICT REQUIREMENTS:
1. Questions MUST strictly match the ${difficulty.toUpperCase()} difficulty level.
2. Questions MUST strictly match their experience level (${profileData.experience || "Not specified"}).
3. Test their claimed skills and technologies for the ${targetRole} role.
4. Provide a mix of technical and scenario-based questions matching this level.

Return ONLY a valid JSON array with no markdown: [{"question": "...", "answer": "..."}]`;

    const questionCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: questionPrompt }],
      model: "openai/gpt-oss-120b",
    });

    const questionText = questionCompletion.choices[0].message.content.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```json|```/g, "").trim();
    const questionsData = JSON.parse(questionText);

    const session = await Session.create({
      userId: req.user.id,
      role: targetRole,
      experience: profileData.experience ? parseInt(profileData.experience) || 0 : 0,
      description: `Resume-based: ${profileData.summary || "Questions generated from uploaded resume"}`,
      difficulty,
    });

    const savedQuestions = await Promise.all(
      questionsData.map(async (q) => {
        const question = await Question.create({
          sessionId: session._id,
          question: q.question,
          answer: q.answer,
        });
        const qObj = question.toJSON();
        qObj.id = question._id.toString();
        return qObj;
      })
    );

    const sObj = session.toJSON();
    sObj.id = session._id.toString();

    res.status(201).json({
      message: `${savedQuestions.length} questions generated from your resume!`,
      session: sObj,
      profile: profileData,
      questions: savedQuestions,
    });
  } catch (error) {
    if (req.file && require("fs").existsSync(req.file.path)) {
      require("fs").unlinkSync(req.file.path);
    }
    console.log("RESUME ERROR:", error.message);
    res.status(500).json({ message: "Failed to process resume", error: error.message });
  }
}

module.exports = { generateQuestions, explainQuestion, evaluateTest, generateQuiz, evaluateQuiz, generateFromResume };
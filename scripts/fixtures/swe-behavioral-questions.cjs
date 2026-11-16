// Evaluation questions, not candidate stories or runtime question classifiers.
module.exports = [
  ['technical-problem', 'Tell me about a time you solved a difficult technical problem.', 'technical problem-solving'],
  ['efficiency', 'Describe a time you improved a slow or inefficient system.', 'performance and process improvement'],
  ['initiative', 'Tell me about a time you took initiative.', 'initiative'],
  ['leadership', 'Give an example of when you demonstrated leadership.', 'leadership and enabling others'],
  ['teamwork', 'Tell me about a time you worked with a team.', 'collaboration and personal contribution'],
  ['conflict', 'Describe a disagreement with a teammate.', 'respectful conflict resolution'],
  ['failure', 'Tell me about a time you failed.', 'accountability and learning'],
  ['feedback', 'Describe a time you received critical feedback.', 'learning from feedback'],
  ['learning', 'Tell me about a time you had to learn something quickly.', 'adaptability'],
  ['ambiguity', 'Describe a situation where requirements were unclear.', 'ambiguity'],
  ['priorities', 'Tell me about a time you had multiple priorities.', 'prioritization and tradeoffs'],
  ['reliability', 'Give an example of how you improved software reliability.', 'reliability and validation'],
  ['proud-project', "Tell me about a project you're particularly proud of.", 'ownership and product impact'],
  ['tradeoff', 'Describe a difficult engineering tradeoff.', 'engineering judgment'],
  ['incomplete-information', 'Tell me about a time you made a decision with incomplete information.', 'decisions under uncertainty'],
  ['helping-others', 'Tell me about a time you helped someone else succeed.', 'mentoring and collaboration'],
  ['biggest-challenge', "What is the biggest technical challenge you've worked on?", 'technical depth'],
  ['motivation', 'Why are you interested in software engineering?', 'direct motivation'],
  ['introduction', 'Tell me about yourself.', 'Present-Past-Future'],
  ['reflection', 'What would you do differently on a past project?', 'direct reflection; proposed changes are not past actions']
].map(([id, question, competency]) => ({ id, question, competency }));

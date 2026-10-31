// Fictional leads and call transcripts for the Demo CRM, so the app can
// be tried without a real CRM account. Names and details are invented.

const ago = (days, hhmm) => {
  const d = new Date(Date.now() - days * 86400000);
  const [h, m] = hhmm.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

export const DEMO_LEADS = [
  {
    id: "demo-lead-priya",
    name: "Priya Sharma",
    stage: "Prospect",
    calls: [
      {
        activityId: "demo-call-priya-1",
        createdOn: ago(1, "05:10"),
        duration: "668",
        transcript: `[0:00] Hello, am I speaking with Priya?
[0:03] Yes, this is Priya.
[0:05] Hi Priya, this is Karthik, a counsellor from SkillPath. You enquired about our data analytics program yesterday.
[0:12] Yes, I filled the form on your website.
[0:15] Great. Is this a good time to talk for ten minutes?
[0:18] Yes, I am free now.
[0:20] Could you tell me a bit about yourself? What are you doing currently?
[0:25] I completed my B.Tech in electronics in 2022 and I am working as a technical support engineer in Pune.
[0:33] How long have you been working there?
[0:35] Almost two and a half years now.
[0:38] And what made you look at data analytics?
[0:41] My work is very repetitive. I want to move into a data analyst role where I can work with dashboards and SQL.
[0:50] That makes sense. Have you done any SQL or Excel before?
[0:54] Basic Excel at work, but no SQL.
[0:57] That's fine, the program starts from zero. It is six months, live classes on weekends, with eight projects and placement support.
[1:10] Weekends work for me because I have a full-time job.
[2:40] Let me walk you through the curriculum. We cover Excel, SQL, Python, Power BI and statistics, and the last month is a capstone project.
[4:15] Does the placement support guarantee a job?
[4:19] We don't guarantee a job, but you get mock interviews, resume reviews and referrals to our hiring partners. Most learners from non-data roles get interviews within three months of finishing.
[5:02] Okay. What is the fee?
[5:05] The program fee is 85,000 rupees.
[5:09] That is a bit too much for me right now. I was expecting something around fifty thousand.
[5:15] I understand. We have no-cost EMI for twelve months, so it comes to around seven thousand a month. There is also a ten percent scholarship if you enrol this week.
[5:30] Seven thousand a month is manageable for me.
[6:45] Can I attend a class before I decide?
[6:49] Yes, we have a free demo class this Saturday at 11 am. Shall I book you in?
[6:54] Yes, please book it.
[7:00] Done. You will get the link on WhatsApp. I will also call you on Sunday to hear your feedback.
[10:50] Thank you so much, Karthik.
[10:53] Thank you Priya, have a good day.`
      }
    ]
  },
  {
    id: "demo-lead-arjun",
    name: "Arjun Reddy",
    stage: "Prospect",
    calls: [
      {
        activityId: "demo-call-arjun-1",
        createdOn: ago(2, "09:40"),
        duration: "545",
        transcript: `[0:00] Hello, is this Arjun?
[0:02] Yes, who is this?
[0:04] Hi Arjun, I'm Sneha from SkillPath. You signed up for information on our full stack development course.
[0:11] Oh yes, I did.
[0:13] Are you studying right now or working?
[0:16] I am in my final year of BCA in Hyderabad. I graduate next May.
[0:22] Nice. What are you planning after graduation?
[0:26] I want to get a job as a web developer. Most of my friends are going for MCA but I want to start working.
[0:35] Do you know any programming already?
[0:38] I know a little HTML and Java from college.
[0:42] Good base. Our full stack course covers JavaScript, React, Node and databases, with live projects.
[2:30] How many hours do I need daily? I have college till 3 pm.
[2:35] Classes are in the evening, 7 to 9, three days a week, plus around an hour of practice.
[2:44] That should be okay.
[4:10] Do you help with placements for freshers?
[4:14] Yes, freshers are our biggest group. You get interview prep and access to our job portal.
[5:20] What is the fee?
[5:22] It is 70,000, and there is a student discount of 15 percent.
[5:28] I will have to talk to my parents about the fee. They will decide.
[5:33] Of course. Would it help if I explain the program to your parents on a call?
[5:38] Yes, that would help. My father is free on Monday evening.
[5:44] I will call on Monday at 7 pm then, with you and your father.
[8:55] Okay, thank you.
[9:00] Thank you Arjun, talk on Monday.`
      }
    ]
  },
  {
    id: "demo-lead-meena",
    name: "Meena Iyer",
    stage: "Prospect",
    calls: [
      {
        activityId: "demo-call-meena-1",
        createdOn: ago(3, "06:20"),
        duration: "492",
        transcript: `[0:00] Hello, Meena?
[0:02] Yes, speaking.
[0:04] Hi, this is Karthik from SkillPath, regarding the data science program you looked at.
[0:10] Okay, yes.
[0:12] What do you do currently, Meena?
[0:15] I work in HR at a manufacturing company in Chennai, for about six years.
[0:22] And what interested you in data science?
[0:26] I saw an ad and thought I should explore it. I am not very sure.
[0:32] The program is nine months, with classes on weekday evenings and weekends.
[2:10] Nine months is very long. I have a small child at home and I can't give that much time.
[2:18] We do have recorded sessions you can watch later, and you can pause for up to two months.
[2:26] Even then, I don't think I can manage it this year.
[4:05] Would a shorter course in HR analytics be more useful for you?
[4:10] Maybe later, not now. I am not interested in joining anything right now.
[4:16] Understood. Should I check back in a few months?
[4:20] No, please don't call. I will reach out if I need it.
[8:05] Okay Meena, thank you for your time.
[8:08] Thank you.`
      }
    ]
  },
  {
    id: "demo-lead-rahul",
    name: "Rahul Verma",
    stage: "Prospect",
    calls: [
      {
        activityId: "demo-call-rahul-2",
        createdOn: ago(0, "04:30"),
        duration: "24",
        transcript: `[0:00] If you record your name and reason for calling, I'll see if this person is available.
[0:18] I'm sorry, this person is not available.`
      },
      {
        activityId: "demo-call-rahul-1",
        createdOn: ago(4, "11:15"),
        duration: "731",
        transcript: `[0:00] Hi Rahul, this is Sneha from SkillPath. Is it a good time?
[0:04] Yes, go ahead.
[0:06] You asked about our data analytics program. What are you doing currently?
[0:11] I am a sales executive at an FMCG company in Delhi. I did my B.Com in 2019.
[0:18] What would you like to achieve with this program?
[0:22] I want to move into business analytics. My manager says people who know SQL and Power BI get promoted faster.
[0:31] That's right. Our program has a business analytics track with SQL, Power BI and case studies from sales data.
[3:40] Is there any certificate from a university?
[3:44] Yes, you get a joint certificate with our university partner.
[5:10] The fee is 85,000 with EMI options.
[5:15] Fee is fine for me, my company may reimburse part of it.
[6:20] I am worried I won't be able to keep up because I am not from a technical background.
[6:27] Many of our learners are from sales and commerce backgrounds. We have a two-week foundation module and doubt sessions every day.
[6:38] Okay, that helps.
[8:30] Can you send me the brochure and the reimbursement invoice format?
[8:34] Sure, I will send both on email today. Can we talk on Friday after you check with your company?
[8:40] Yes, Friday afternoon works.
[12:05] Thanks, Sneha.
[12:08] Thank you Rahul.`
      }
    ]
  }
];

export const DEMO_FIELDS = [
  { name: "work_experience", label: "Work Experience", type: "String" },
  { name: "job_role", label: "Job Role", type: "String" },
  { name: "company", label: "Company", type: "String" },
  { name: "city", label: "City", type: "String" },
  { name: "qualification", label: "Highest Qualification", type: "String" },
  { name: "lead_stage", label: "Lead Stage", type: "Select" }
];

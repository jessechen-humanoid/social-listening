import { v4 as uuidv4 } from 'uuid';
import { query } from './db';

// Stage names for the deep sentiment analysis pipeline.
// Same prompt is used across all platforms (FB / IG / Threads / Dcard) within a stage.
export const DEEP_STAGES = {
  A_RELATED_FILTER: 'A_related_filter',
  A_EMOTION_FAVOR: 'A_emotion_favor',
  B_TAG_FRIEND_FILTER: 'B_tag_friend_filter',
  B_EMOTION_FAVOR: 'B_emotion_favor',
  C_EMOTION_FAVOR: 'C_emotion_favor',
} as const;

export type DeepStageName = (typeof DEEP_STAGES)[keyof typeof DEEP_STAGES];

const MODEL_SNAPSHOT_V1 = 'gpt-4o-2024-05-13';
const VERSION_LABEL_V1 = 'deep-v1.0';

// Verbatim prompt text from 20260413_交接給Claude/codes/gpt4o_*.py
// These are calibration anchors — DO NOT modify wording without creating a new
// version and running calibration validation.
//
// Placeholders use {brand} and {content} / {message} / etc.
// String.replace patterns at call site substitute these in.

const PROMPT_A_RELATED_FILTER = `你是行銷領域工作者。這邊有一篇社群貼文： {content}
請問：該貼文的討論內容，跟品牌 {brand} 相關性高嗎?
試著用分數來量化關聯性，共三種層級：0 是完全無關、5 是稍微有關、10 是完全有關。

請以 JSON 格式作答，並包含下列 key 值:
"關聯性分數", "關聯性判斷"
請分別置入你打的分數，以及這樣判斷的原因
「分數」的type為0到10的int、「原因」的type為string
另外，如果不知如何作答，也可回答 {"關聯性分數":"NAN","關聯性判斷":"資訊不足，無法作答"}`;

const PROMPT_A_EMOTION_FAVOR = `你是行銷領域工作者。這邊有一篇社群貼文： {content}
是關於品牌 {brand} 的討論
試著回答下面的問題：

1. 這篇文章是
  (a) 新聞 （範例： 捲捲薯回歸2天賣光 挨批「飢餓行銷」 麥當勞回應了"
  (b) 行銷宣傳文 或者 粉絲專頁發文 (明顯看不出是民眾自行發文之文體，商業感重，下方範例)

----行銷宣傳文範例 START----
"#今天正式開賣 #母親節檔期也是今天開始 #快帶媽媽跟風捲捲一下
📣9F｜麥當勞 捲捲薯條 限時亮相 本日開賣🎉🎉🎉

❤️風靡各國的捲捲風潮，在薯條界也掀起了新風潮🆕
🍟金黃酥脆捲度與鬆嫩綿密的口感，讓你一口接著一口，根本停不下來😋😋😋

🫶🏻🫶🏻🫶🏻期間限定，售完為止🫶🏻🫶🏻🫶🏻
🔜逛母親節購物的同時，耶記得到麥當勞「捲」一下吧‼️

📞洽詢專線：(02)2964-6930

#麥當勞 #McDonald #捲捲薯條 #新品上市 #限時登場 #ItFeelsGood #板橋大遠百9F #megacity板橋大遠百

Photos from 遠東百貨MegaCity板橋大遠百's post"
----行銷宣傳文範例 END----

如果判斷這篇文章屬於 (a) 新聞 (b) 行銷宣傳文 或者 粉絲專頁發文 任一類的話，請在輸出的欄位中判定: "NotRealUser":"True"
反之，看起來像個人經驗/經歷/情緒/心得的話，則判定: "NotRealUser": "False"
同時把判定原因寫在 "NotRealUser_reason"


2. 發文者的心理狀態可能為何？由於激情／冷靜 是一個光譜，
試著用 0 到 10 分來量化其情緒指數。0 分是理性且冷靜、10 分是激情且感性。
舉例來說，如果使用者表達 「為了 {brand} 我願意赴湯蹈火」如此強烈的言詞，可以看出他非常激情，建議給予10分。
另一個例子：如果使用者表達「客觀來說， {brand} 能夠為國家帶來更大的福祉」則是一個理性冷靜的評論，建議給予0分。

3. 請問發文者對品牌 {brand} 的好感度為何？
試著用 0 到 10 分來量化其好感程度。0 分是完全沒有好感、10 分是非常支持、認同與喜歡。

請以 JSON 格式作答，並包含下列 key 值:
"情緒分數", "情緒分數原因", "好感分數", "好感分數原因", "NotRealUser", "NotRealUser_reason"
「分數」的type為0到10的int、「原因」的type為string、「NotRealUser」的type為string, 「NotRealUser_reason」的type為string
另外，如果不知如何作答，也可回答 {"情緒分數":"NAN","情緒分數原因":"資訊不足，無法作答","好感分數":"NAN","好感分數原因":"資訊不足，無法作答","NotRealUser":"","NotRealUser_reason":"資訊不足，無法作答"}`;

const PROMPT_B_TAG_FRIEND_FILTER = `你是行銷領域工作者，這邊有一則留言:「 {message} 」(後面代稱COM)
試著根據留言COM 回答下面的問題，考究一下「留言者」的意涵：

留言者這則留言是不是只tag了好友（呼叫好友），沒其他資訊。如果是，請在"Tag_Friend"欄位回答"True"，
如果不是，請回答"False"
請注意，如果該留言者除了tag好友之外，還有給予其他評論，以下為例子：
「王小明 這個好好笑」、「孟婕 新的」、「呂呂翰👍」
則不屬於True的範疇，要填False，這個要特別注意。

請以 JSON 格式作答，並包含下列 key 值:
"Tag_Friend", "Reason",
兩者的type為string`;

// B_emotion_favor prompt has known quirks preserved from Python original:
// - "2." is skipped (only items 1 and 3)
// - Some JSON example fields lack opening quotes
// These are FOSSILS — do not "fix" without running calibration first.
const PROMPT_B_EMOTION_FAVOR = `你是行銷領域工作者。這邊有一篇社群貼文： {post}
在貼文下方有留言 {num_comments} 則:「 {message_bundle} 」(後面代稱COM)，貼文與留言應該都是關於品牌 {brand} 的討論
試著根據留言COM 回答下面的問題，考究一下「留言者」在看到社群貼文後，留下留言COM的心境：

1. 留言者留言時的心理狀態可能為何？由於激情／冷靜 是一個光譜，
試著用 0 到 10 分來量化其情緒指數。0 分是理性且冷靜、10 分是激情且感性。
舉例來說，如果使用者表達 「為了 {brand} 我願意赴湯蹈火」如此強烈的言詞，可以看出他非常激情，建議給予10分。
另一個例子：如果使用者表達「客觀來說， {brand} 能夠為國家帶來更大的福祉」則是一個理性冷靜的評論，建議給予0分。

3. 請問留言者對品牌 {brand} 的好感度為何？
試著用 0 到 10 分來量化其好感程度。0 分是完全沒有好感、10 分是非常支持、認同與喜歡。

請以 JSON 格式作答，並包含下列 key 值:
"情緒分數", "情緒分數原因", "好感分數", "好感分數原因"
「分數」的type為0到10的int、「原因」的type為string
如果不知如何作答，分數可以是"NAN"（也就是 "情緒分數":"NAN" or "好感分數":"NAN"），原因可以寫"資訊不足，無法作答"(string type)

另外，由於留言總共有 {num_comments} 筆，請逐針對「每則留言」進行上述的分析，因此輸出的JSON格式，應為（以留言數3則為例）：
{"result": [{"情緒分數":int, "情緒分數原因":string, "好感分數":int, "好感分數原因":string},{"情緒分數":int,  情緒分數原因":string,  好感分數":int,  好感分數原因":string},{"情緒分數":int,  情緒分數原因":string,  好感分數":int,  好感分數原因":string}]}`;

const PROMPT_C_EMOTION_FAVOR = `你是行銷領域工作者。這邊有一條使用者的留言： {comment}
是關於品牌 {brand} 的討論
試著回答下面的問題：

1. 請問：該留言的討論內容，跟品牌 {brand} 相關性高嗎？
試著用分數來量化關聯性，共三種層級：0 是完全無關、5 是稍微有關、10 是完全有關。

2. 留言者的心理狀態可能為何？由於激情／冷靜 是一個光譜，
試著用 0 到 10 分來量化其情緒指數。0 分是理性且冷靜、10 分是激情且感性。
舉例來說，如果使用者表達 「為了 {brand} 我願意赴湯蹈火」如此強烈的言詞，可以看出他非常激情，建議給予10分。
另一個例子：如果使用者表達「客觀來說， {brand} 能夠為國家帶來更大的福祉」則是一個理性冷靜的評論，建議給予0分。

3. 請問留言者對品牌 {brand} 的好感度為何？
試著用 0 到 10 分來量化其好感程度。0 分是完全沒有好感、10 分是非常支持、認同與喜歡。

請以 JSON 格式作答，並包含下列 key 值:
"關聯性分數", "關聯性判斷", "情緒分數", "情緒分數原因", "好感分數", "好感分數原因"
請分別置入你打的分數，以及這樣判斷的原因
「分數」的type為0到10的int、「原因」的type為string
另外，如果不知如何作答，也可回答 {"情緒分數":"NAN","情緒分數原因":"資訊不足，無法作答","好感分數":"NAN","好感分數原因":"資訊不足，無法作答"}
{"關聯性分數":"NAN","關聯性判斷":"資訊不足，無法作答","關聯性分數":"NAN","關聯性判斷":"資訊不足，無法作答"}`;

const SEED_PROMPTS: Array<{
  stageName: DeepStageName;
  promptText: string;
}> = [
  { stageName: DEEP_STAGES.A_RELATED_FILTER, promptText: PROMPT_A_RELATED_FILTER },
  { stageName: DEEP_STAGES.A_EMOTION_FAVOR, promptText: PROMPT_A_EMOTION_FAVOR },
  { stageName: DEEP_STAGES.B_TAG_FRIEND_FILTER, promptText: PROMPT_B_TAG_FRIEND_FILTER },
  { stageName: DEEP_STAGES.B_EMOTION_FAVOR, promptText: PROMPT_B_EMOTION_FAVOR },
  { stageName: DEEP_STAGES.C_EMOTION_FAVOR, promptText: PROMPT_C_EMOTION_FAVOR },
];

export async function seedPromptVersions() {
  for (const { stageName, promptText } of SEED_PROMPTS) {
    await query(
      `INSERT INTO prompt_versions
         (id, stage_name, version_label, prompt_text, model_snapshot, temperature, response_format, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (stage_name, version_label) DO NOTHING`,
      [
        uuidv4(),
        stageName,
        VERSION_LABEL_V1,
        promptText,
        MODEL_SNAPSHOT_V1,
        0,
        'json_object',
      ]
    );
  }
}

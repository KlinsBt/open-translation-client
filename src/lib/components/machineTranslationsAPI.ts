export async function sendDeepLRequest() {
	const url = "https://www2.deepl.com/jsonrpc?method=LMT_handle_jobs";

	const headers = {
		"Content-Type": "application/json",
	};

	const payload = {
		jsonrpc: "2.0",
		method: "LMT_handle_jobs",
		params: {
			jobs: [
				{
					kind: "default",
					sentences: [
						{
							text: "<P>Hello There</P>",
							id: 1,
							prefix: "",
						},
					],
					raw_en_context_before: [],
					raw_en_context_after: [],
					preferred_num_beams: 4,
				},
			],
			lang: {
				target_lang: "DE",
				preference: {
					weight: {},
					default: "default",
				},
				source_lang_computed: "EN",
			},
			priority: -1,
			commonJobParams: {
				quality: "fast",
				mode: "translate",
				browserType: 1,
				textType: "richtext",
			},
			timestamp: Date.now(),
		},
		id: 10760022,
	};

	try {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			// mode: "no-cors",
		});

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}`);
		}

		const data = await response.json();
		console.log("Response from DeepL:", data);
		return data;
	} catch (error) {
		console.error("Error sending request to DeepL:", error);
		throw error;
	}
}

export async function sendLibreTranslateRequest() {
	const res = await fetch("https://libretranslate.com/translate", {
		method: "POST",
		body: JSON.stringify({
			q: '<p class="green">Hello!</p>',
			source: "en",
			target: "es",
			format: "html",
		}),
		headers: { "Content-Type": "application/json" },
	});

	console.log(await res.json());
}

// async function translate(str: String, lang1: String, lang2: String) {

//     let escapedStr = str.addingPercentEncoding(withAllowedCharacters: CharacterSet.urlQueryAllowed)
//     let lastPart = lang1 + "&tl=" + lang2 + "&dt=t&dt=t&q=" + escapedStr!
//     let urlStr: String = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=" + lastPart
//     let url = URL(string: urlStr)

//     let task = URLSession.shared.downloadTask(with: url!) { localURL, urlResponse, error in
//         if let localURL = localURL {
//             if let string = try? String(contentsOf: localURL) {
//                 let index = string.firstIndex(of: "\"")
//                 let index2 = string.index(after: index!)
//                 let subst = string.substring(from: index2)
//                 let indexf = subst.firstIndex(of: "\"")
//                 let result = subst.substring(to: indexf!)
//                 DispatchQueue.main.async {
//                     if flag1country != flag2country {
//                         self.texto.text = result
//                     }
//                 }
//             }
//         }
//     }
//     task.resume()
// }

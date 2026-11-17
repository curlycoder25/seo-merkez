# SEO Mərkəzi

SEO auditi, səhifə metadatası, Search Console hesabatları və SEO yayımlaması üçün şəxsi panel.

## Öz serverində quraşdır

1. [Panel reposunu](https://github.com/curlycoder25/seo-merkez) serverinə klonla. Node.js 24 və ya daha yeni versiyanı quraşdır.
2. `npm ci` işə sal. `cp .env.example .env` yazıb nümunə faylını kopyala.
3. `SEO_PUBLIC_URL` üçün panelin dəqiq HTTPS ünvanını yaz. Məsələn, `https://seo.senindomenin.com`. Dəyərin sonuna slash əlavə etmə. `SEO_ADMIN_PASSWORD` üçün unikal, təsadüfi parol seç.
4. Domenin DNS qeydini serverə yönəlt. Caddy və ya Nginx ilə HTTPS qur və sorğuları `127.0.0.1:8787` ünvanına ötür. Məsələn, Caddyfile:

   ```caddyfile
   seo.senindomenin.com {
       reverse_proxy 127.0.0.1:8787
   }
   ```

5. `npm start` ilə işə sal. Daimi işləməsi üçün serverindəki proses menecerində bu əmri qeyd et. Domeni açanda brauzerin giriş pəncərəsində `SEO_ADMIN_USER` və `SEO_ADMIN_PASSWORD` dəyərlərindən istifadə et.

Panel qaralamaları və hesabatları `SEO_DB_PATH` ilə seçilən SQLite faylında saxlayır. Serveri yenidən deploy edəndə həmin yolu davamlı diskdə saxla. SQLite məlumatları öz serverində yaradılır. ChatGPT Sites-də saxlanmış əvvəlki qaralamalar buraya avtomatik köçürülmür.

## GitHub yayımlama bağlantısı

1. [GitHub Fine-grained token](https://github.com/settings/personal-access-tokens/new) yarat. **Only select repositories** seç və dəyişikliklərin gedəcəyi repo üçün, məsələn `curlycoder25/bubora-lms`, **Contents → Read and write** icazəsi ver. Tokeni yalnız serverdə `SEO_GITHUB_TOKEN` dəyişəninə yaz.
2. `SEO_GITHUB_TARGETS` daxilində canlı saytın domenini repo və deploy branch-i ilə əlaqələndir. Nümunə `.env.example` faylındadır. Açar kimi panelin domenini deyil, SEO dəyişikliklərinin gedəcəyi saytın HTTPS origin-ini yaz. Bir tokenlə idarə edəcəyin bütün repolar onun seçilmiş repo siyahısında olmalıdır.
3. Mənbə faylları `public` kimi alt qovluqdadırsa, domenin ayarına `"root":"public"` əlavə et. Panel `/` üçün `index.html`, `/haqqimizda` üçün isə `haqqimizda/index.html` və ya `haqqimizda.html` axtarır. Xüsusi URL-ləri `"routes":{"/haqqimizda":"public/about.html"}` kimi repo kökündən başlayaraq xəritələ. Fayl repodakı HTML mənbə faylı olmalıdır.
4. Serveri yenidən işə sal. Paneldə **Səhifələr → Qaralamanı saxla → Yayımlamanı önizlə → GitHub-a yayımla** düymələrindən istifadə et. Önizləmə cari HTML ilə yeni metadata arasındakı fərqi göstərir. Yayımlama seçilmiş branch-də bir GitHub commit yaradır.
5. Canlı saytın hosting xidməti həmin repo və branch-ə bağlı olmalıdır. Netlify-də production branch-i yoxla. Öz serverində GitHub push-ları üçün CI/CD və ya deploy webhook-u qur. Hosting deploy-u uğurla başa vurduqdan sonra dəyişiklik canlı domendə görünür.

Dəstəklənən hədəflər repoda HTML faylı saxlayan saytlardır. Next.js, WordPress və metadata-nı dinamik yaradan sistemlər öz metadata mənbəyi üçün ayrıca inteqrasiya tələb edir. Doldurulmuş sahələr `head` daxilində yenilənir. Boş qaralama sahələri cari teqləri saxlayır. JSON-LD sahəsi doldurulduqda `head` daxilindəki mövcud JSON-LD bloklarını həmin dəyərlə əvəz edir. Dəyişiklik audit üçün görülən sayta commit kimi gedir. Görünən səhifə məzmunu və stil faylları redaktə olunmur.

Branch qorunursa və birbaşa commit qəbul etmirsə, mövcud branch qaydalarına uyğun ayrıca deploy axını tələb olunur. `.env`, GitHub tokeni və SQLite faylını repoya yükləmə.

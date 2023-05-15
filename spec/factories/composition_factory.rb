FactoryBot.define do
  factory :composition do
    title { association(:title, **title_options) }

    transient do
      attribution_text { nil }
      composer_name { nil }
      country { nil }
      source_code { nil }
      source_from_year_annotation { nil }
      source_title { nil }
      source_town { nil }
      source_type { nil }
      title_language { nil }
      title_text { nil }

      composer_options {
        {
          birthplace_2: country,
          name: composer_name,
        }.compact_blank
      }

      inclusion_options {
        {
          attribution_text:,
          source_code:,
          source_from_year_annotation:,
          source_title:,
          source_town:,
          source_type:,
        }.compact_blank
      }

      title_options {
        {
          language: title_language,
          text: title_text,
        }.compact_blank
      }
    end

    trait :with_composer do
      composers { [association(:composer, **composer_options)] }
    end

    trait :with_function do
      title { association(:title, :with_function) }
    end

    trait :with_inclusion do
      inclusions { [association(:inclusion, **inclusion_options)] }
    end

    trait :with_voicing do
      inclusions { [association(:inclusion, :with_voicing)] }
    end
  end
end

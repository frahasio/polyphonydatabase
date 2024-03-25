FactoryBot.define do
  factory :inclusion do
    sequence(:order)

    transient do
      attribution_text { nil }
      source_code { nil }
      source_from_year_annotation { nil }
      source_title { nil }
      source_town { nil }
      source_type { nil }

      attribution_options {
        {
          inclusion: instance,
          text: attribution_text,
        }.compact_blank
      }

      source_options {
        {
          inclusions: [instance],
          code: source_code,
          from_year_annotation: source_from_year_annotation,
          title: source_title,
          town: source_town,
          type: source_type,
        }.compact_blank
      }
    end

    attributions do
      if attribution_text
        [association(:attribution, **attribution_options)]
      else
        []
      end
    end

    source { association(:source, **source_options) }

    trait :with_voicing do
      clef_inclusions { [association(:clef_inclusion)] }
      clef_combination { association(:clef_combination, :with_voicing, display: clef_inclusions.pluck(:clef).join) }
    end
  end
end

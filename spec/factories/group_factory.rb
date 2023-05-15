FactoryBot.define do
  factory :group do
    sequence(:display_title) { |n| "Group #{n}" }

    with_composition

    transient do
      attribution_text { nil }
      composer_name { nil }
      composition_tone { nil }
      composition_type { nil }
      country { nil }
      edition_file_url { nil }
      edition_voicing { nil }
      editor_name { nil }
      number_of_voices { nil }
      performer_name { nil }
      recording_file_url { nil }
      source_code { nil }
      source_from_year_annotation { nil }
      source_title { nil }
      source_town { nil }
      source_type { nil }
      title { nil }

      composition_options {
        {
          attribution_text:,
          composer_name:,
          composition_type:,
          country:,
          group: instance,
          number_of_voices:,
          source_code:,
          source_from_year_annotation:,
          source_title:,
          source_town:,
          source_type:,
          title_text: title,
          tone: composition_tone,
        }.compact_blank
      }

      edition_options {
        {
          editor_name:,
          file_url: edition_file_url,
          group: instance,
          voicing: edition_voicing,
        }.compact_blank
      }

      recording_options {
        {
          file_url: recording_file_url,
          group: instance,
          performer_name:,
        }.compact_blank
      }
    end

    trait :with_composer do
      compositions { [association(:composition, :with_composer, **composition_options)] }
    end

    trait :with_composition do
      compositions { [association(:composition, **composition_options)] }
    end

    trait :with_edition do
      editions { [association(:edition, **edition_options)] }
    end

    trait :with_function do
      compositions { [association(:composition, :with_function)] }
    end

    trait :with_inclusion do
      compositions { [association(:composition, :with_inclusion, **composition_options)] }
    end

    trait :with_recording do
      recordings { [association(:recording, **recording_options)] }
    end

    trait :with_voicing do
      compositions { [association(:composition, :with_voicing)] }
    end
  end
end

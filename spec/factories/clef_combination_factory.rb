FactoryBot.define do
  factory :clef_combination do
    sequence(:display) { |n| "c1" * n }

    trait :with_voicing do
      voicings { [association(:voicing)] }
    end
  end
end

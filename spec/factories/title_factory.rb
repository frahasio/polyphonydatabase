FactoryBot.define do
  factory :title do
    sequence(:text) { |n| "Title #{n}" }

    trait :with_function do
      functions { [association(:function)] }
    end
  end
end

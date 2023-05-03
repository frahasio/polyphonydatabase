FactoryBot.define do
  factory :composer do
    sequence(:name) { |n| "Composer #{n}" }
  end
end

FactoryBot.define do
  factory :recording do
    sequence(:file_url) { |n| "file_#{n}.pdf" }

    transient do
      performer_name { nil }

      performer_options {
        {
          name: performer_name,
        }.compact_blank
      }
    end

    performer do
      if performer_name.present?
        association(:performer, **performer_options)
      end
    end
  end
end

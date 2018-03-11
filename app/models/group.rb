class Group < ApplicationRecord
  has_many :compositions
  has_many :editions
  has_many :recordings

  validate :matching_voices

private

  def matching_voices
    if compositions.pluck(:number_of_voices).uniq.count > 1
      errors.add(:base, "All compositions in the group must have the same number of voices")
    end
  end
end

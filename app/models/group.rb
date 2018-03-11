class Group < ApplicationRecord
  has_many :compositions, inverse_of: :group

  has_many :composers, through: :compositions
  has_many :inclusions, through: :compositions
  has_many :sources, through: :inclusions

  has_many :editions, inverse_of: :group
  has_many :recordings, inverse_of: :group

  has_many :titles, through: :compositions
  has_many :functions, through: :titles

  validate :matching_voices

private

  def matching_voices
    if compositions.pluck(:number_of_voices).uniq.count > 1
      errors.add(:base, "All compositions in the group must have the same number of voices")
    end
  end
end

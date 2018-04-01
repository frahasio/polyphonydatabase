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

  accepts_nested_attributes_for :editions, reject_if: :all_blank
  before_validation :delete_blank_editions

  def multiple?
    @multiple = (compositions.count > 1) if @multiple.nil?
    @multiple
  end

private

  def delete_blank_editions
    editions.each do |edition|
      edition.mark_for_destruction if edition.voicing.blank? && edition.file_url.blank?
    end
  end

  def matching_voices
    if compositions.pluck(:number_of_voices).uniq.count > 1
      errors.add(:base, "All compositions in the group must have the same number of voices")
    end
  end
end
